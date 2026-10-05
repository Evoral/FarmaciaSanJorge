"use client";

/**
 * Camera scanner of the QR import (docs/specs/importacion-receta-qr.md, "Lectura
 * con la cámara"). It only reads: on the first decoded QR that carries a receta
 * it stops and hands the text to the parent (`onLeido`), which puts it in the SAME
 * input and submits the SAME form as a typed or pasted code. The server action
 * validates it like any other text; nothing about the camera is trusted.
 *
 * Decoder: the native `BarcodeDetector` when it knows QR codes (Android Chrome),
 * otherwise jsQR over a canvas copy of the frame (iOS Safari, Firefox), loaded
 * only then. Frames are read on a throttled loop with an in-flight guard, never
 * faster than the decoder answers. A native detector that throws on several frames
 * in a row hands over to jsQR; jsQR failing the same way ends in an error message.
 *
 * The camera is a privacy-sensitive device: EVERY MediaStream track is stopped on
 * a decoded QR, on "Cerrar cámara", on unmount, when the tab is hidden (also when the
 * permission only resolves after that), when the camera disconnects, and when the
 * permission request resolves after the scanner was already closed.
 *
 * One run per mount and per "Reintentar" (the `intento` counter restarts the effect).
 * What the user must be told is announced through the panel's live region
 * (`onAnunciar`) and shown as text next to the video.
 */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import {
  MENSAJE_CAMARA_CERRADA_AL_SALIR,
  MENSAJE_CAMARA_ESCANEANDO,
  MENSAJE_CAMARA_NO_ES_RECETA,
  MENSAJE_CAMARA_SOLICITANDO,
  RESTRICCIONES_CAMARA,
  accionTrasFallos,
  accionTrasObtenerCamara,
  claseErrorCamara,
  dimensionesFrame,
  esQrNoReceta,
  estadoPermiteReintentar,
  evaluarLecturaQr,
  mensajeEstadoCamara,
  motorLectura,
  pistaVigente,
  soporteCamara,
  type EntornoCamara,
  type EstadoMensajeCamara,
  type UltimaLecturaQr,
} from "./camara-qr";

/** Frame reading period (ms): about 8 frames per second is plenty for a QR held still. */
const INTERVALO_LECTURA_MS = 125;
/** Frames are scaled down to this width before jsQR reads them: it keeps the decode fast on phones. */
const ANCHO_MAXIMO_FRAME = 640;

/** The part of the WICG Shape Detection API used here (it is not in the TypeScript DOM lib). */
interface DetectorDeCodigos {
  detect(fuente: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface ConstructorDetector {
  new (opciones: { formats: string[] }): DetectorDeCodigos;
  getSupportedFormats(): Promise<string[]>;
}

type EstadoEscaner = { tipo: "solicitando" } | { tipo: "escaneando" } | { tipo: "mensaje"; estado: EstadoMensajeCamara };

export interface EscanerQrCamaraProps {
  /** A QR that carries a receta was decoded: the camera is already stopped. */
  onLeido: (texto: string) => void;
  /** The scanner closed itself or was closed by the user. `mensaje` says why, when it is not the user's own click. */
  onCerrar: (mensaje?: string) => void;
  /** Status text for the panel's live region. */
  onAnunciar: (mensaje: string) => void;
}

/** What the browser says about the camera right now, as plain values for the pure helpers. */
export function leerEntornoCamara(detectorSoportaQr: boolean): EntornoCamara {
  const politica = (document as Document & { featurePolicy?: { allowsFeature(nombre: string): boolean } }).featurePolicy;
  return {
    isSecureContext: window.isSecureContext,
    tieneGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    politicaPermiteCamara: politica ? politica.allowsFeature("camera") : undefined,
    detectorSoportaQr,
  };
}

async function detectorNativoParaQr(): Promise<DetectorDeCodigos | null> {
  const Constructor = (globalThis as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector;
  if (!Constructor) return null;
  try {
    if (!(await Constructor.getSupportedFormats()).includes("qr_code")) return null;
    return new Constructor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export function EscanerQrCamara({ onLeido, onCerrar, onAnunciar }: EscanerQrCamaraProps) {
  const [estado, setEstado] = useState<EstadoEscaner>({ tipo: "solicitando" });
  const [pistaNoEsReceta, setPistaNoEsReceta] = useState(false);
  const [intento, setIntento] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const botonCerrarRef = useRef<HTMLButtonElement>(null);
  // The callbacks are read through refs so the camera effect runs once per attempt, not on every parent render.
  const callbacks = useRef({ onLeido, onCerrar, onAnunciar });
  useEffect(() => {
    callbacks.current = { onLeido, onCerrar, onAnunciar };
  });

  useEffect(() => {
    let terminado = false;
    let stream: MediaStream | null = null;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let ultima: UltimaLecturaQr | null = null;
    let politicaPermiteCamara: boolean | undefined;

    const detener = () => {
      terminado = true;
      clearTimeout(temporizador);
      stream?.getTracks().forEach((pista) => pista.stop());
      stream = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const mostrarMensaje = (mensajeEstado: EstadoMensajeCamara) => {
      setEstado({ tipo: "mensaje", estado: mensajeEstado });
      callbacks.current.onAnunciar(mensajeEstadoCamara(mensajeEstado));
    };

    /** Stops everything and says why: a scanner that cannot read must not keep a camera open. */
    const terminarConMensaje = (mensajeEstado: EstadoMensajeCamara) => {
      detener();
      mostrarMensaje(mensajeEstado);
    };

    const alOcultarse = () => {
      if (document.visibilityState !== "hidden" || terminado) return;
      detener();
      callbacks.current.onCerrar(MENSAJE_CAMARA_CERRADA_AL_SALIR);
    };

    // Unplugged, revoked or taken by another app: the loop would read a frozen frame forever.
    const alDesconectarse = () => {
      if (!terminado) terminarConMensaje("desconectada");
    };

    async function iniciar() {
      const detector = await detectorNativoParaQr();
      if (terminado) return;
      const entorno = leerEntornoCamara(detector !== null);
      politicaPermiteCamara = entorno.politicaPermiteCamara;
      const soporte = soporteCamara(entorno);
      if (soporte !== "ok") return mostrarMensaje(soporte);

      try {
        const obtenido = await navigator.mediaDevices.getUserMedia(RESTRICCIONES_CAMARA);
        // Closed (or unmounted) while the permission prompt was open: do not keep a camera nobody is looking at.
        if (terminado) return obtenido.getTracks().forEach((pista) => pista.stop());
        stream = obtenido;
      } catch (error) {
        if (!terminado) mostrarMensaje(claseErrorCamara(error, politicaPermiteCamara));
        return;
      }

      // The user may have left the tab while the permission prompt was open (before any `visibilitychange` we listen to).
      if (accionTrasObtenerCamara(document.visibilityState) === "pausar") return terminarConMensaje("pausada");
      stream.addEventListener("inactive", alDesconectarse);
      stream.getTracks().forEach((pista) => pista.addEventListener("ended", alDesconectarse));

      const video = videoRef.current;
      if (!video) return detener();
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can reject when the element was detached meanwhile; the closed-state checks below cover that.
      }
      if (terminado) return;
      setEstado({ tipo: "escaneando" });
      callbacks.current.onAnunciar(MENSAJE_CAMARA_ESCANEANDO);

      let motor: "barcode-detector" | "jsqr" = motorLectura(entorno) === "barcode-detector" && detector ? "barcode-detector" : "jsqr";
      let leerFrame: () => Promise<string[]>;
      try {
        leerFrame = await crearLectorDeFrames(motor, video, detector);
      } catch {
        // The jsQR chunk failed to load (offline, deploy in between) or there is no 2D canvas: without a decoder the camera is useless.
        if (!terminado) terminarConMensaje("error");
        return;
      }
      if (terminado) return;

      let fallos = 0;
      let pistaDesde: number | null = null;
      let pistaVisible = false;

      const ciclo = async () => {
        let textos: string[] = [];
        let fallo = false;
        try {
          textos = await leerFrame();
          fallos = 0;
        } catch {
          // One frame that cannot be decoded is just a frame without a QR; a decoder that keeps throwing is broken.
          fallo = true;
          fallos += 1;
        }
        if (terminado) return;
        if (fallo) {
          const accion = accionTrasFallos(fallos, motor);
          if (accion === "error") return terminarConMensaje("error");
          if (accion === "usar-jsqr") {
            try {
              leerFrame = await crearLectorDeFrames("jsqr", video, null);
              motor = "jsqr";
              fallos = 0;
            } catch {
              if (!terminado) terminarConMensaje("error");
              return;
            }
            if (terminado) return;
          }
        }
        const ahora = Date.now();
        for (const texto of textos) {
          const resultado = evaluarLecturaQr(texto, ahora, ultima);
          ultima = resultado.ultima;
          if (resultado.veredicto === "receta") {
            detener();
            callbacks.current.onLeido(texto.trim());
            return;
          }
          // The hint lives while that QR stays in view (the dedupe ignores its repeats, this does not).
          if (esQrNoReceta(texto)) {
            pistaDesde = ahora;
            if (!pistaVisible) {
              pistaVisible = true;
              setPistaNoEsReceta(true);
              callbacks.current.onAnunciar(MENSAJE_CAMARA_NO_ES_RECETA);
            }
          }
        }
        if (pistaVisible && !pistaVigente(pistaDesde, ahora)) {
          pistaVisible = false;
          pistaDesde = null;
          setPistaNoEsReceta(false);
        }
        temporizador = setTimeout(ciclo, INTERVALO_LECTURA_MS);
      };
      temporizador = setTimeout(ciclo, INTERVALO_LECTURA_MS);
    }

    document.addEventListener("visibilitychange", alOcultarse);
    void iniciar();
    return () => {
      document.removeEventListener("visibilitychange", alOcultarse);
      detener();
    };
  }, [intento]);

  const reintentar = () => {
    setPistaNoEsReceta(false);
    setEstado({ tipo: "solicitando" });
    setIntento((n) => n + 1);
    botonCerrarRef.current?.focus();
  };

  const mensaje =
    estado.tipo === "mensaje" ? mensajeEstadoCamara(estado.estado) : estado.tipo === "escaneando" ? MENSAJE_CAMARA_ESCANEANDO : MENSAJE_CAMARA_SOLICITANDO;
  const esProblema = estado.tipo === "mensaje";
  const necesitaRecarga = estado.tipo === "mensaje" && estado.estado === "bloqueada-politica";
  const puedeReintentar = estado.tipo === "mensaje" && estadoPermiteReintentar(estado.estado);

  return (
    <div className="flex flex-col gap-3 sm:max-w-sm">
      {esProblema ? null : (
        <video
          ref={videoRef}
          aria-label="Vista de la cámara para escanear el QR de la receta"
          muted
          playsInline
          className="aspect-video w-full rounded-lg bg-zinc-900 object-cover"
        />
      )}
      <div className={esProblema ? "alert alert-danger" : "alert alert-info"}>
        {esProblema ? <AlertCircle aria-hidden /> : null}
        <p>{pistaNoEsReceta && estado.tipo === "escaneando" ? `${mensaje} ${MENSAJE_CAMARA_NO_ES_RECETA}` : mensaje}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {necesitaRecarga ? (
          <button type="button" onClick={() => window.location.reload()} className="btn btn-primary btn-sm">
            Recargar la página
          </button>
        ) : null}
        {puedeReintentar ? (
          <button type="button" onClick={reintentar} className="btn btn-primary btn-sm">
            <RefreshCw className="size-4" aria-hidden />
            Reintentar
          </button>
        ) : null}
        <button ref={botonCerrarRef} type="button" onClick={() => callbacks.current.onCerrar()} className="btn btn-secondary btn-sm">
          <X className="size-4" aria-hidden />
          Cerrar cámara
        </button>
      </div>
    </div>
  );
}

/**
 * Builds the function that reads the texts of one frame with the given decoder. Throws when the
 * decoder cannot be built (the jsQR chunk does not load, the canvas has no 2D context).
 */
async function crearLectorDeFrames(motor: "barcode-detector" | "jsqr", video: HTMLVideoElement, detector: DetectorDeCodigos | null): Promise<() => Promise<string[]>> {
  if (motor === "barcode-detector" && detector) {
    return async () => (await detector.detect(video)).map((codigo) => codigo.rawValue);
  }

  const { default: jsQR } = await import("jsqr");
  const lienzo = document.createElement("canvas");
  const contexto = lienzo.getContext("2d", { willReadFrequently: true });
  if (!contexto) throw new Error("canvas without a 2D context");
  return async () => {
    if (video.readyState < 2 || video.videoWidth === 0) return [];
    const { ancho, alto } = dimensionesFrame(video.videoWidth, video.videoHeight, ANCHO_MAXIMO_FRAME);
    // Assigning width/height reallocates the bitmap: do it only when the video size changed.
    if (lienzo.width !== ancho || lienzo.height !== alto) {
      lienzo.width = ancho;
      lienzo.height = alto;
    }
    contexto.drawImage(video, 0, 0, ancho, alto);
    const { data, width, height } = contexto.getImageData(0, 0, ancho, alto);
    const codigo = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
    return codigo ? [codigo.data] : [];
  };
}
