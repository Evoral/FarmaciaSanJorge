"use client";

/**
 * "Importar con QR o link" (docs/specs/importacion-receta-qr.md): sends the
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
 */
import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { AlertCircle, Camera, QrCode, X } from "lucide-react";
import { leerRecetaQrAction } from "./actions";
import { IDLE_LEER_RECETA_STATE } from "./action-state";
import { MENSAJE_ANUNCIO_LEYENDO, textoAnuncioLectura } from "./anuncio-lectura";
import { MENSAJE_CAMARA_CERRADA, MENSAJE_CAMARA_LECTURA_EN_CURSO, enviarFormulario, mensajeEstadoCamara, soporteCamara } from "./camara-qr";
import { EscanerQrCamara, leerEntornoCamara } from "./escaner-qr-camara";
import { debeRecuperarFoco } from "./foco-lectura";
import type { VistaPreviaImportacion } from "../domain/importacion-receta";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

export interface ImportarRecetaQrProps {
  onLeida: (vistaPrevia: VistaPreviaImportacion) => void;
  onDescartar: () => void;
  importando: boolean;
  /** Focus the input on mount. The parent turns it off once a receta was read, so a remount does not steal the focus. Default: true. */
  autoEnfocar?: boolean;
}

/** The camera support never changes while the page is open: nothing to subscribe to. */
const noSuscribirse = () => () => {};

export function ImportarRecetaQr({ onLeida, onDescartar, importando, autoEnfocar = true }: ImportarRecetaQrProps) {
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
  /** Set on submit, cleared when a result arrives: closes the gap before `isPending` turns true. */
  const enVuelo = useRef(false);
  /** Who started the reading in flight, and who starts the next one (set only around the camera's own submit). */
  const origenLectura = useRef<"camara" | "teclado">("teclado");
  const origenSiguiente = useRef<"camara" | "teclado">("teclado");
  const inputId = useId();
  const errorId = useId();
  const avisoCamaraId = useId();

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

  const mostrarError = state.status === "error" && !isPending;
  // Only a problem with the typed code marks the input invalid; an outage or a permission error is not the input's fault.
  const entradaInvalida = mostrarError && state.campo === "codigo";
  const anuncio = textoAnuncioLectura({ isPending, status: state.status, importando }) || anuncioCamara;
  const camaraDisponible = soporte !== null && soporte !== "inseguro" && soporte !== "sin-api";

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
              Usá el lector, pegá el link o escaneá con la cámara.
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
            placeholder="Escaneá el QR o pegá el link"
            className="input min-w-0 flex-1"
          />
          {/* Hidden: Enter and `enviarFormulario`'s pre-Safari-16 fallback still submit through it. */}
          <button type="submit" disabled={isPending} hidden tabIndex={-1} aria-hidden />
          {isPending ? <span className="spinner" aria-hidden title={MENSAJE_ANUNCIO_LEYENDO} /> : null}
          {soporte === null ? null : (
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
      {soporte !== null && !camaraDisponible ? (
        <p id={avisoCamaraId} className="px-4 pb-4 text-[0.8125rem] text-zinc-500 sm:px-5">
          {mensajeEstadoCamara(soporte)}
        </p>
      ) : null}
      {camaraAbierta ? (
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
