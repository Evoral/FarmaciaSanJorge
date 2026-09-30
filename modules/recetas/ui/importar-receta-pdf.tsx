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
    <section aria-labelledby="importar-pdf-heading" className="card p-4">
      <h2 id="importar-pdf-heading" className="mb-1 text-lg font-medium">
        Importar desde PDF
      </h2>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Subí el PDF de una receta digital para precargar el formulario. Revisá la vista previa antes de confirmar: no se guarda nada hasta que confirmes, y el PDF no se almacena.
      </p>
      <form action={formAction} onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="text-sm font-medium">
            PDF de la receta
          </label>
          <input
            id={inputId}
            name="archivo"
            type="file"
            accept="application/pdf,.pdf"
            required
            onChange={handleChange}
            className="cursor-pointer text-sm text-zinc-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-800 hover:file:bg-zinc-50 dark:text-zinc-400"
          />
        </div>
        {isPending ? (
          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            Leyendo…
          </p>
        ) : null}
        {importando ? (
          <button type="button" onClick={onDescartar} className="btn btn-secondary">
            Descartar importación
          </button>
        ) : null}
      </form>
      {clientError ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {clientError}
        </p>
      ) : state.status === "error" ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
