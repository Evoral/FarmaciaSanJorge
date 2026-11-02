"use client";

/**
 * "Importar con QR o link" (openspec/specs/importacion-receta-qr/spec.md): sends the
 * text of a receta's QR or link to `leerRecetaQrAction` (POST only: the text
 * never goes into a URL of this app) and hands the resulting preview to the
 * parent, which prefills the receta form with it. Nothing is saved here.
 *
 * It is a plain text input on purpose: a USB scanner types the code and
 * presses Enter, and a pasted link is read right away (there is no "Leer" button). The input is focused on load (unless
 * the parent says a receta was already read), and focused and selected again
 * after a successful reading and after discarding the import, so the next scan
 * REPLACES the previous text instead of being appended to it. After an ERROR it
 * only takes the focus back when nothing else has it (the body, or this panel):
 * a late error must not pull the user away from the manual form.
 *
 * Feedback for assistive technology: a persistent `role="status"` region (always
 * rendered, only its text changes) announces the reading and its success; an
 * error is a `role="alert"` linked to the input by `aria-describedby`
 * (plus `aria-invalid` when the error is about the typed code itself). The
 * alert is removed while a new reading is pending and inserted again with its
 * result, so the SAME error twice in a row is announced twice.
 *
 * Camera: once mounted, the panel offers "Escanear con la cámara" (escaner-qr-camara.tsx).
 * What the camera decodes goes into the SAME input and through the SAME form submit
 * (`requestSubmit`), so the camera is only another way to type the code. Where the
 * camera cannot work (an insecure page, no camera API) the button is disabled and says why.
 * The scanner's status texts use this panel's live region too. A reading that starts (typed or
 * scanned) closes the scanner; a camera decode that arrives while a reading is in flight is
 * announced, never dropped silently. A reading that came from the camera does not move the focus
 * (it would open the on-screen keyboard of a phone over the preview).
 *
 * Modo del lector (spec «Modo del lector» to «El modo no cambia la lectura»): the farmacia's mode comes from the
 * server; "En este equipo" can override it, stored in this browser (preferencia-lector-qr.ts). In LECTOR mode the
 * camera button, its notice and the scanner are not rendered; switching to it with the camera open closes it. The
 * selector sits outside the form and after the input, so the input keeps the focus and a USB scan always lands in it.
 * The mode only changes what is shown: the reading path is the same in both.
 */
import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { AlertCircle, Camera, QrCode, X } from "lucide-react";
import { leerRecetaQrAction } from "./actions";
import { IDLE_LEER_RECETA_STATE } from "./action-state";
import { MENSAJE_ANUNCIO_LEYENDO, textoAnuncioLectura } from "./anuncio-lectura";
import { MENSAJE_CAMARA_CERRADA, MENSAJE_CAMARA_LECTURA_EN_CURSO, enviarFormulario, mensajeEstadoCamara, soporteCamara } from "./camara-qr";
import { EscanerQrCamara, leerEntornoCamara } from "./escaner-qr-camara";
import { debeRecuperarFoco } from "./foco-lectura";
import { almacenDelNavegador, guardarPreferenciaLectorQr, leerPreferenciaLectorQr } from "./preferencia-lector-qr";
import type { VistaPreviaImportacion } from "../domain/importacion-receta";
import {
  ELECCION_EQUIPO_SEGUN_FARMACIA,
  ETIQUETA_MODO_LECTOR_QR,
  MODOS_LECTOR_QR,
  resolverModoLectorQr,
  type EleccionEquipoLectorQr,
  type ModoLectorQr,
} from "../domain/modo-lector-qr";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

export interface ImportarRecetaQrProps {
  onLeida: (vistaPrevia: VistaPreviaImportacion) => void;
  onDescartar: () => void;
  importando: boolean;
  /** Focus the input on mount. The parent turns it off once a receta was read, so a remount does not steal the focus. Default: true. */
  autoEnfocar?: boolean;
  /** The farmacia's modo del lector (`lector_qr_receta`); "En este equipo" can override it. */
  modoLectorFarmacia: ModoLectorQr;
  /** Keys the equipo's choice per farmacia. */
  tenantId: string;
}

/** The camera support never changes while the page is open: nothing to subscribe to. */
const noSuscribirse = () => () => {};

/** Another tab changing this equipo's choice applies here too. */
const suscribirseAlAlmacen = (avisar: () => void) => {
  window.addEventListener("storage", avisar);
  return () => window.removeEventListener("storage", avisar);
};

const TEXTO_POR_MODO: Record<ModoLectorQr, { ayuda: string; placeholder: string }> = {
  CAMARA: { ayuda: "Usá el lector, pegá el link o escaneá con la cámara.", placeholder: "Escaneá el QR o pegá el link" },
  LECTOR: { ayuda: "Escaneá el QR con el lector o pegá el link.", placeholder: "Escaneá el QR con el lector o pegá el link" },
};

export function ImportarRecetaQr({ onLeida, onDescartar, importando, autoEnfocar = true, modoLectorFarmacia, tenantId }: ImportarRecetaQrProps) {
  const [state, formAction, isPending] = useActionState(leerRecetaQrAction, IDLE_LEER_RECETA_STATE);
  const { onSubmit } = useFormSubmit(formAction);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const botonCamaraRef = useRef<HTMLButtonElement>(null);
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const [anuncioCamara, setAnuncioCamara] = useState("");
  // null on the server and during hydration (the browser is unknown there): the camera button appears once mounted.
  const soporte = useSyncExternalStore(
    noSuscribirse,
    () => soporteCamara(leerEntornoCamara(false)),
    () => null,
  );
  // null on the server and during hydration (the browser's choice is unknown there): the farmacia's mode until mounted.
  const eleccionGuardada = useSyncExternalStore(
    suscribirseAlAlmacen,
    () => leerPreferenciaLectorQr(almacenDelNavegador(), tenantId),
    () => null,
  );
  /** The choice made on this page: it holds even when the browser refuses to save it. */
  const [eleccionEnPagina, setEleccionEnPagina] = useState<EleccionEquipoLectorQr | null>(null);
  const eleccionEquipo = eleccionEnPagina ?? eleccionGuardada ?? ELECCION_EQUIPO_SEGUN_FARMACIA;
  const modo = resolverModoLectorQr({ farmacia: modoLectorFarmacia, equipo: eleccionEquipo });
  /** Set on submit, cleared when a result arrives: closes the gap before `isPending` turns true. */
  const enVuelo = useRef(false);
  /** Who started the reading in flight, and who starts the next one (set only around the camera's own submit). */
  const origenLectura = useRef<"camara" | "teclado">("teclado");
  const origenSiguiente = useRef<"camara" | "teclado">("teclado");
  const inputId = useId();
  const errorId = useId();
  const avisoCamaraId = useId();
  const selectorEquipoId = useId();

  const enfocarYSeleccionar = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  useEffect(() => {
    if (state.status === "idle") return;
    enVuelo.current = false;
    // A late error must not steal the focus from the manual form the user moved on to.
    if (debeRecuperarFoco({ status: state.status, activo: document.activeElement, cuerpo: document.body, panel: panelRef.current, origen: origenLectura.current })) enfocarYSeleccionar();
    if (state.status === "success") onLeida(state.vistaPrevia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // A scanner that sends Enter twice would otherwise start a second reading while the first is in flight.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (isPending || enVuelo.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    enVuelo.current = true;
    origenLectura.current = origenSiguiente.current;
    setAnuncioCamara("");
    // Whatever started the reading, the scanner has nothing left to do: it must not keep the camera on.
    setCamaraAbierta(false);
    onSubmit(event);
  };

  const abrirCamara = () => setCamaraAbierta(true);

  // What the camera decoded takes the same path as a typed code: into the input, then the form's own submit.
  const alLeerConCamara = (texto: string) => {
    setCamaraAbierta(false);
    // A reading is already running: its result comes first, and the user is told to scan again.
    if (isPending || enVuelo.current) {
      setAnuncioCamara(MENSAJE_CAMARA_LECTURA_EN_CURSO);
      return;
    }
    if (inputRef.current) inputRef.current.value = texto;
    if (!formRef.current) return;
    origenSiguiente.current = "camara";
    try {
      enviarFormulario(formRef.current);
    } finally {
      origenSiguiente.current = "teclado";
    }
  };

  // `mensaje` is set when the scanner closed itself (tab hidden); a click on "Cerrar cámara" gives the focus back to the button.
  const alCerrarCamara = (mensaje?: string) => {
    setCamaraAbierta(false);
    setAnuncioCamara(mensaje ?? MENSAJE_CAMARA_CERRADA);
    if (mensaje === undefined) botonCamaraRef.current?.focus();
  };

  // There is no "Leer" button: a pasted link is read right away, like a scanner's Enter.
  const pegado = useRef(false);
  const alCambiarTexto = () => {
    if (!pegado.current) return;
    pegado.current = false;
    if (inputRef.current?.value.trim() && formRef.current) enviarFormulario(formRef.current);
  };

  const handleDescartar = () => {
    onDescartar();
    enfocarYSeleccionar();
  };

  // Saved per farmacia in this browser; the focus stays where it is (on the selector).
  const alElegirEnEquipo = (eleccion: EleccionEquipoLectorQr) => {
    guardarPreferenciaLectorQr(almacenDelNavegador(), tenantId, eleccion);
    setEleccionEnPagina(eleccion);
    // Lector USB has no scanner: an open camera closes (unmounting it stops every track).
    if (camaraAbierta && resolverModoLectorQr({ farmacia: modoLectorFarmacia, equipo: eleccion }) === "LECTOR") {
      setCamaraAbierta(false);
      setAnuncioCamara(MENSAJE_CAMARA_CERRADA);
    }
  };

  const mostrarError = state.status === "error" && !isPending;
  // Only a problem with the typed code marks the input invalid; an outage or a permission error is not the input's fault.
  const entradaInvalida = mostrarError && state.campo === "codigo";
  const anuncio = textoAnuncioLectura({ isPending, status: state.status, importando }) || anuncioCamara;
  const camaraDisponible = soporte !== null && soporte !== "inseguro" && soporte !== "sin-api";
  const conCamara = modo === "CAMARA";

  return (
    <section ref={panelRef} aria-labelledby="importar-qr-heading">
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="tone-tile" data-tone={importando ? "success" : "neutral"} aria-hidden>
            <QrCode />
          </span>
          <div className="min-w-0">
            <h3 id="importar-qr-heading" className="text-sm font-semibold text-zinc-900">
              {importando ? "Receta importada con QR" : "Con el QR o el link de la receta"}
            </h3>
            <p className="mt-0.5 text-[0.8125rem] text-zinc-500">
              {TEXTO_POR_MODO[modo].ayuda}
            </p>
          </div>
        </div>
        <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="flex w-full flex-wrap items-center gap-2 lg:w-[26rem] lg:flex-none">
          <label htmlFor={inputId} className="sr-only">
            QR o link de la receta
          </label>
          <input
            id={inputId}
            ref={inputRef}
            name="codigo"
            type="text"
            required
            autoFocus={autoEnfocar}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            readOnly={isPending}
            onPaste={() => {
              pegado.current = true;
            }}
            onChange={alCambiarTexto}
            aria-invalid={entradaInvalida ? true : undefined}
            aria-describedby={mostrarError ? errorId : undefined}
            placeholder={TEXTO_POR_MODO[modo].placeholder}
            className="input min-w-0 flex-1"
          />
          {/* Hidden: Enter and `enviarFormulario`'s pre-Safari-16 fallback still submit through it. */}
          <button type="submit" disabled={isPending} hidden tabIndex={-1} aria-hidden />
          {isPending ? <span className="spinner" aria-hidden title={MENSAJE_ANUNCIO_LEYENDO} /> : null}
          {soporte === null || !conCamara ? null : (
            <button
              ref={botonCamaraRef}
              type="button"
              onClick={abrirCamara}
              disabled={!camaraDisponible || isPending}
              aria-label="Escanear con la cámara"
              title="Escanear con la cámara"
              aria-expanded={camaraDisponible ? camaraAbierta : undefined}
              aria-describedby={camaraDisponible ? undefined : avisoCamaraId}
              className="btn btn-secondary px-5 py-2"
            >
              <Camera className="size-5" aria-hidden />
            </button>
          )}
          {importando ? (
            <button type="button" onClick={handleDescartar} className="btn btn-ghost">
              <X className="size-4" aria-hidden />
              Descartar
            </button>
          ) : null}
          <p role="status" className="sr-only">
            {anuncio}
          </p>
        </form>
      </div>
      {/* Outside the form: changing it never submits. After the input in tab order: the input keeps the first focus. */}
      <div className="flex items-center justify-end gap-2 px-4 pb-3 text-[0.8125rem] text-zinc-500 sm:px-5">
        <label htmlFor={selectorEquipoId}>En este equipo</label>
        <select
          id={selectorEquipoId}
          value={eleccionEquipo}
          onChange={(event) => alElegirEnEquipo(event.target.value as EleccionEquipoLectorQr)}
          className="input input-sm w-auto"
        >
          <option value={ELECCION_EQUIPO_SEGUN_FARMACIA}>Según la farmacia ({ETIQUETA_MODO_LECTOR_QR[modoLectorFarmacia]})</option>
          {MODOS_LECTOR_QR.map((opcion) => (
            <option key={opcion} value={opcion}>
              {ETIQUETA_MODO_LECTOR_QR[opcion]}
            </option>
          ))}
        </select>
      </div>
      {conCamara && soporte !== null && !camaraDisponible ? (
        <p id={avisoCamaraId} className="px-4 pb-4 text-[0.8125rem] text-zinc-500 sm:px-5">
          {mensajeEstadoCamara(soporte)}
        </p>
      ) : null}
      {conCamara && camaraAbierta ? (
        <div className="px-4 pb-4 sm:px-5">
          <EscanerQrCamara onLeido={alLeerConCamara} onCerrar={alCerrarCamara} onAnunciar={setAnuncioCamara} />
        </div>
      ) : null}
      {mostrarError ? (
        <div className="px-4 pb-4 sm:px-5">
          <div id={errorId} role="alert" className="alert alert-danger">
            <AlertCircle aria-hidden />
            <p>{state.message}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
