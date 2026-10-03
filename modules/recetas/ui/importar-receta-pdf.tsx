"use client";

/**
 * "Importar desde PDF" (docs/specs/importacion-receta-pdf.md): uploads the
 * digital receta's PDF to `leerRecetaPdfAction` (POST only; the file is read
 * in memory and discarded, nothing is saved) and hands the resulting
 * preview to the parent, which prefills the receta form with it. The
 * size is pre-checked here only for a clearer message -- the server's
 * trust boundary (domain/archivo-receta-pdf.ts) is the real check.
 */
import { useActionState, useEffect, useId, useState, type ChangeEvent } from "react";
import { AlertCircle, FileUp } from "lucide-react";
import { leerRecetaPdfAction } from "./actions";
import { IDLE_LEER_PDF_STATE } from "./action-state";
import { MAX_PDF_BYTES, MENSAJES_ARCHIVO_PDF } from "../domain/archivo-receta-pdf";
import type { VistaPreviaImportacion } from "../domain/importacion-receta";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

export interface ImportarRecetaPdfProps {
  onLeida: (vistaPrevia: VistaPreviaImportacion) => void;
  onDescartar: () => void;
  importando: boolean;
}

export function ImportarRecetaPdf({ onLeida, onDescartar, importando }: ImportarRecetaPdfProps) {
  const [state, formAction, isPending] = useActionState(leerRecetaPdfAction, IDLE_LEER_PDF_STATE);
  const { onSubmit } = useFormSubmit(formAction);
  const [clientError, setClientError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (state.status === "success") onLeida(state.vistaPrevia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    if (archivo.size > MAX_PDF_BYTES) {
      setClientError(MENSAJES_ARCHIVO_PDF.demasiadoGrande);
      e.target.value = "";
      return;
    }
    setClientError(null);
    // Read as soon as a file is picked: no separate "Leer PDF" step to miss.
    e.target.form?.requestSubmit();
  }

  return (
    <section aria-labelledby="importar-pdf-heading" className="panel">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:px-5">
        <span className="tone-tile" data-tone={importando ? "success" : "neutral"} aria-hidden>
          <FileUp />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="importar-pdf-heading" className="text-sm font-semibold text-zinc-900">
            {importando ? "Receta importada desde PDF" : "¿Es una receta digital? Importá el PDF"}
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-zinc-500">
            Precarga el formulario. No se guarda nada hasta que confirmes, y el PDF no se almacena.
          </p>
        </div>
        <form action={formAction} onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            PDF de la receta
          </label>
          <input
            id={inputId}
            name="archivo"
            type="file"
            accept="application/pdf,.pdf"
            required
            onChange={handleChange}
            className="max-w-full cursor-pointer text-sm text-zinc-600 file:mr-3 file:cursor-pointer file:rounded file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-900 hover:file:border-zinc-400 hover:file:bg-zinc-50"
          />
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
      {clientError || state.status === "error" ? (
        <div className="px-4 pb-4 sm:px-5">
          <div role="alert" className="alert alert-danger">
            <AlertCircle aria-hidden />
            <p>{clientError ?? (state.status === "error" ? state.message : null)}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
