"use client";

/**
 * "Importar con QR o link" (docs/specs/importacion-receta-qr.md): sends the
 * text of a receta's QR or link to `leerRecetaQrAction` (POST only: the text
 * never goes into a URL of this app) and hands the resulting preview to the
 * parent, which prefills the receta form with it. Nothing is saved here.
 *
 * It is a plain text input on purpose: a USB scanner types the code and
 * presses Enter, and a link can be pasted. The input is focused on load (unless
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
 */
import { useActionState, useEffect, useId, useRef, type FormEvent } from "react";
import { AlertCircle, QrCode } from "lucide-react";
import { leerRecetaQrAction } from "./actions";
import { IDLE_LEER_RECETA_STATE } from "./action-state";
import { MENSAJE_ANUNCIO_LEYENDO, textoAnuncioLectura } from "./anuncio-lectura";
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

export function ImportarRecetaQr({ onLeida, onDescartar, importando, autoEnfocar = true }: ImportarRecetaQrProps) {
  const [state, formAction, isPending] = useActionState(leerRecetaQrAction, IDLE_LEER_RECETA_STATE);
  const { onSubmit } = useFormSubmit(formAction);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  /** Set on submit, cleared when a result arrives: closes the gap before `isPending` turns true. */
  const enVuelo = useRef(false);
  const inputId = useId();
  const errorId = useId();

  const enfocarYSeleccionar = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  useEffect(() => {
    if (state.status === "idle") return;
    enVuelo.current = false;
    // A late error must not steal the focus from the manual form the user moved on to.
    if (debeRecuperarFoco({ status: state.status, activo: document.activeElement, cuerpo: document.body, panel: panelRef.current })) enfocarYSeleccionar();
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
    onSubmit(event);
  };

  const handleDescartar = () => {
    onDescartar();
    enfocarYSeleccionar();
  };

  const mostrarError = state.status === "error" && !isPending;
  // Only a problem with the typed code marks the input invalid; an outage or a permission error is not the input's fault.
  const entradaInvalida = mostrarError && state.campo === "codigo";
  const anuncio = textoAnuncioLectura({ isPending, status: state.status, importando });

  return (
    <section ref={panelRef} aria-labelledby="importar-qr-heading" className="panel">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:px-5">
        <span className="tone-tile" data-tone={importando ? "success" : "neutral"} aria-hidden>
          <QrCode />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="importar-qr-heading" className="text-sm font-semibold text-zinc-900">
            {importando ? "Receta importada con QR" : "¿Tenés el QR de la receta? Escanealo o pegá el link"}
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-zinc-500">
            Precarga el formulario. No se guarda nada hasta que confirmes.
          </p>
        </div>
        <form action={formAction} onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
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
            aria-invalid={entradaInvalida ? true : undefined}
            aria-describedby={mostrarError ? errorId : undefined}
            placeholder="Escaneá el QR o pegá el link"
            className="input w-full sm:w-72"
          />
          <button type="submit" disabled={isPending} className="btn btn-secondary btn-sm">
            Leer receta
          </button>
          {isPending ? (
            <p aria-hidden className="flex items-center gap-2 text-sm text-zinc-600">
              <span className="spinner" aria-hidden />
              {MENSAJE_ANUNCIO_LEYENDO}
            </p>
          ) : null}
          {importando ? (
            <button type="button" onClick={handleDescartar} className="btn btn-ghost btn-sm">
              Descartar importación
            </button>
          ) : null}
          <p role="status" className="sr-only">
            {anuncio}
          </p>
        </form>
      </div>
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
