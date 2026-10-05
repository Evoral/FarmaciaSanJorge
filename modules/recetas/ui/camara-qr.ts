/**
 * Pure decisions behind the camera scanner of the QR import
 * (docs/specs/importacion-receta-qr.md, "Lectura con la cámara"). The scanner
 * component (escaner-qr-camara.tsx) only gathers plain values from the browser
 * and acts on what these functions answer, so they are testable without a DOM
 * or a camera. Nothing here touches `window`, `navigator` or `document`.
 */
import { extraerHashRcta } from "../domain/receta-qr";

/** What the browser offers, as plain values read by the component. */
export interface EntornoCamara {
  /** `window.isSecureContext`: HTTPS or localhost. Without it `navigator.mediaDevices` does not exist. */
  isSecureContext: boolean;
  /** `typeof navigator.mediaDevices?.getUserMedia === "function"`. */
  tieneGetUserMedia: boolean;
  /**
   * `document.featurePolicy?.allowsFeature("camera")`: whether THIS document may use the camera
   * under its Permissions-Policy. `undefined` when the browser does not expose it (Firefox, Safari).
   */
  politicaPermiteCamara: boolean | undefined;
  /** `BarcodeDetector` exists AND `getSupportedFormats()` lists "qr_code". */
  detectorSoportaQr: boolean;
}

export type SoporteCamara = "ok" | "inseguro" | "sin-api" | "bloqueada-politica";

/** Whether the camera can be used at all in this document, and if not, why (the first reason found). */
export function soporteCamara(env: EntornoCamara): SoporteCamara {
  if (!env.isSecureContext) return "inseguro";
  if (!env.tieneGetUserMedia) return "sin-api";
  if (env.politicaPermiteCamara === false) return "bloqueada-politica";
  return "ok";
}

export type MotorLectura = "barcode-detector" | "jsqr" | "sin-camara";

/** Which decoder reads the frames: the native one when it knows QR codes, jsQR otherwise, none without a usable camera. */
export function motorLectura(env: EntornoCamara): MotorLectura {
  if (soporteCamara(env) !== "ok") return "sin-camara";
  return env.detectorSoportaQr ? "barcode-detector" : "jsqr";
}

export type ClaseErrorCamara = "permiso-denegado" | "sin-camara" | "en-uso" | "bloqueada-politica" | "error";

/**
 * The states of the scanner that end in a message (policy and environment problems included).
 * "desconectada": the camera was unplugged or taken away while scanning. "pausada": the tab
 * was hidden when the permission resolved, so the camera was stopped right away.
 */
export type EstadoMensajeCamara = ClaseErrorCamara | "inseguro" | "sin-api" | "desconectada" | "pausada";

/** What `getUserMedia` is asked for: the rear camera and a 1280 px frame, both as preferences (a laptop still opens). */
export const RESTRICCIONES_CAMARA = { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false } as const;

const ERRORES_DE_PERMISO = new Set(["NotAllowedError", "SecurityError"]);
const ERRORES_SIN_CAMARA = new Set(["NotFoundError", "OverconstrainedError"]);

function nombreDeError(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "name" in err && typeof err.name === "string") return err.name;
  return null;
}

/**
 * Classifies what `getUserMedia` rejected with. A permission error in a document whose
 * Permissions-Policy forbids the camera is NOT the user's refusal: asking again can never
 * work, only loading the page again (the policy is fixed per document load).
 */
export function claseErrorCamara(err: unknown, politicaPermiteCamara: boolean | undefined): ClaseErrorCamara {
  const nombre = nombreDeError(err);
  if (nombre === null) return "error";
  if (ERRORES_DE_PERMISO.has(nombre)) return politicaPermiteCamara === false ? "bloqueada-politica" : "permiso-denegado";
  if (ERRORES_SIN_CAMARA.has(nombre)) return "sin-camara";
  if (nombre === "NotReadableError") return "en-uso";
  return "error";
}

const SALIDA_MANUAL = "Podés escribir o pegar el link de la receta.";

const MENSAJES_ESTADO_CAMARA: Readonly<Record<EstadoMensajeCamara, string>> = {
  inseguro: `La cámara solo funciona en una conexión segura (HTTPS). ${SALIDA_MANUAL}`,
  "sin-api": `Este navegador no permite usar la cámara. ${SALIDA_MANUAL}`,
  "bloqueada-politica": `Esta página se cargó sin permiso para usar la cámara. Recargá la página para activarla. ${SALIDA_MANUAL}`,
  "permiso-denegado": `No hay permiso para usar la cámara. Permitilo en el navegador y volvé a intentar. ${SALIDA_MANUAL}`,
  "sin-camara": `No se encontró una cámara en este dispositivo. ${SALIDA_MANUAL}`,
  "en-uso": `La cámara está siendo usada por otra aplicación. Cerrala y volvé a intentar. ${SALIDA_MANUAL}`,
  error: `No se pudo abrir la cámara. ${SALIDA_MANUAL}`,
  desconectada: `La cámara se desconectó. Volvé a intentar. ${SALIDA_MANUAL}`,
  pausada: `Cámara pausada porque la pestaña estaba oculta. Tocá Reintentar para reanudar. ${SALIDA_MANUAL}`,
};

export function mensajeEstadoCamara(estado: EstadoMensajeCamara): string {
  return MENSAJES_ESTADO_CAMARA[estado];
}

/** Whether trying the camera again can change the outcome: not for an insecure page, a missing API or a policy block (that one needs a reload). */
export function estadoPermiteReintentar(estado: EstadoMensajeCamara): boolean {
  return estado !== "inseguro" && estado !== "sin-api" && estado !== "bloqueada-politica";
}

/** Consecutive frames the decoder may fail on before the scanner changes engine (or gives up). */
export const MAX_FALLOS_DETECTOR = 5;

/**
 * What to do after `fallos` frames in a row could not be decoded at all (the decoder threw, which
 * is not the same as a frame with no QR in it): keep going, switch the native detector to jsQR, or
 * stop with an error when jsQR is the engine already (a spinning camera that reads nothing is worse).
 */
export function accionTrasFallos(fallos: number, motor: "barcode-detector" | "jsqr"): "seguir" | "usar-jsqr" | "error" {
  if (fallos < MAX_FALLOS_DETECTOR) return "seguir";
  return motor === "barcode-detector" ? "usar-jsqr" : "error";
}

/** The permission prompt can resolve after the user left the tab: a hidden document must not keep the camera on. */
export function accionTrasObtenerCamara(visibilidad: string): "continuar" | "pausar" {
  return visibilidad === "hidden" ? "pausar" : "continuar";
}

/** The same text seen again within this window (ms) is the same QR in front of the camera, not a new reading. */
export const VENTANA_DEDUPE_MS = 3000;

export interface UltimaLecturaQr {
  texto: string;
  instante: number;
}

export type VeredictoLecturaQr = "vacia" | "duplicada" | "no-receta" | "receta";

/**
 * What to do with a text the decoder just returned. Empty texts and repeats of the same
 * text within `VENTANA_DEDUPE_MS` are ignored (a camera sees the same QR in every frame,
 * so one QR must not submit twice); a QR that carries no receta hash is reported so the
 * user gets a hint instead of silence; a receta QR is accepted. `ultima` is the dedupe
 * memory to carry to the next call: a repeat does not extend the window.
 */
export function evaluarLecturaQr(
  texto: string,
  ahora: number,
  ultima: UltimaLecturaQr | null,
): { veredicto: VeredictoLecturaQr; ultima: UltimaLecturaQr | null } {
  const limpio = texto.trim();
  if (limpio === "") return { veredicto: "vacia", ultima };
  if (ultima !== null && ultima.texto === limpio && ahora - ultima.instante < VENTANA_DEDUPE_MS) return { veredicto: "duplicada", ultima };
  return { veredicto: extraerHashRcta(limpio) === null ? "no-receta" : "receta", ultima: { texto: limpio, instante: ahora } };
}

/** How long (ms) the "not a receta" hint stays after the last time that same QR was in view. */
export const VIGENCIA_PISTA_MS = 3000;

/** A QR with text but no receta hash: what the scanner hints about, even on the frames the dedupe ignores. */
export function esQrNoReceta(texto: string): boolean {
  const limpio = texto.trim();
  return limpio !== "" && extraerHashRcta(limpio) === null;
}

/** Whether a hint last refreshed at `desde` is still worth showing at `ahora` (null: no hint pending). */
export function pistaVigente(desde: number | null, ahora: number): boolean {
  return desde !== null && ahora - desde < VIGENCIA_PISTA_MS;
}

/** The canvas size for a frame of the video: at most `anchoMaximo` wide, same aspect ratio, whole pixels. */
export function dimensionesFrame(anchoVideo: number, altoVideo: number, anchoMaximo: number): { ancho: number; alto: number } {
  const escala = Math.min(1, anchoMaximo / anchoVideo);
  return { ancho: Math.round(anchoVideo * escala), alto: Math.round(altoVideo * escala) };
}

/** The part of an HTMLFormElement `enviarFormulario` needs. */
export interface FormularioEnviable {
  requestSubmit?: () => void;
  querySelector(selector: string): unknown;
}

/**
 * Submits the form through its own submit handlers. `requestSubmit` is missing before Safari 16:
 * there, clicking the form's submit button fires the same `submit` event.
 */
export function enviarFormulario(formulario: FormularioEnviable): void {
  if (typeof formulario.requestSubmit === "function") formulario.requestSubmit();
  else (formulario.querySelector('button[type="submit"]') as { click(): void } | null)?.click();
}

/** Texts of the scanner while it runs, announced through the panel's live region and shown next to the video. */
export const MENSAJE_CAMARA_SOLICITANDO = "Solicitando permiso para usar la cámara…";
export const MENSAJE_CAMARA_ESCANEANDO = "Cámara activa. Apuntá al QR de la receta.";
export const MENSAJE_CAMARA_NO_ES_RECETA = "Ese QR no es de una receta. Seguí buscando.";
export const MENSAJE_CAMARA_CERRADA = "Cámara cerrada.";
/** A camera decode arrived while another reading was in flight: said out loud instead of dropped silently. */
export const MENSAJE_CAMARA_LECTURA_EN_CURSO = "Ya se está leyendo una receta. Cuando termine, escaneá de nuevo si hace falta.";
export const MENSAJE_CAMARA_CERRADA_AL_SALIR = "Cámara cerrada al salir de la pestaña.";
