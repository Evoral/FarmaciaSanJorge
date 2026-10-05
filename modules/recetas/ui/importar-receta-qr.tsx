"use client";

/**
 * "Importar con QR o link" (docs/specs/importacion-receta-qr.md): sends the
 * text of a receta's QR or link to `leerRecetaQrAction` (POST only: the text
 * never goes into a URL of this app) and hands the resulting preview to the
 * parent, which prefills the receta form with it. Nothing is saved here.
 *
 * It is a plain text input on purpose: a USB scanner types the code and
 * presses Enter, and a link can be pasted. The input is focused on load, and
 * selected again after every reading, so the next scan REPLACES the previous
 * text instead of being appended to it.
 */
import { useActionState, useEffect, useId, useRef } from "react";
import { AlertCircle, QrCode } from "lucide-react";
import { leerRecetaQrAction } from "./actions";
import { IDLE_LEER_RECETA_STATE } from "./action-state";
import type { VistaPreviaImportacion } from "../domain/importacion-receta";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

export interface ImportarRecetaQrProps {
  onLeida: (vistaPrevia: VistaPreviaImportacion) => void;
  onDescartar: () => void;
  importando: boolean;
}

export function ImportarRecetaQr({ onLeida, onDescartar, importando }: ImportarRecetaQrProps) {
  const [state, formAction, isPending] = useActionState(leerRecetaQrAction, IDLE_LEER_RECETA_STATE);
  const { onSubmit } = useFormSubmit(formAction);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (state.status === "idle") return;
    inputRef.current?.select();
    if (state.status === "success") onLeida(state.vistaPrevia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <section aria-labelledby="importar-qr-heading" className="panel">
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
        <form action={formAction} onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            QR o link de la receta
          </label>
          <input
            id={inputId}
            ref={inputRef}
            name="codigo"
            type="text"
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            readOnly={isPending}
            placeholder="Escaneá el QR o pegá el link"
            className="input w-full sm:w-72"
          />
          <button type="submit" disabled={isPending} className="btn btn-secondary btn-sm">
            Leer receta
          </button>
          {isPending ? (
            <p role="status" className="flex items-center gap-2 text-sm text-zinc-600">
              <span className="spinner" aria-hidden />
              Leyendo…
            </p>
          ) : null}
          {importando ? (
            <button type="button" onClick={onDescartar} className="btn btn-ghost btn-sm">
              Descartar importación
            </button>
          ) : null}
        </form>
      </div>
      {state.status === "error" ? (
        <div className="px-4 pb-4 sm:px-5">
          <div role="alert" className="alert alert-danger">
            <AlertCircle aria-hidden />
            <p>{state.message}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
