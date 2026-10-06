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
import { AlertCircle, FileText, Upload, X } from "lucide-react";
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
    <section aria-labelledby="importar-pdf-heading">
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="tone-tile" data-tone={importando ? "success" : "neutral"} aria-hidden>
            <FileText />
          </span>
          <div className="min-w-0">
            <h3 id="importar-pdf-heading" className="text-sm font-semibold text-zinc-900">
              {importando ? "Receta importada desde PDF" : "Desde el PDF de la receta"}
            </h3>
            <p className="mt-0.5 text-[0.8125rem] text-zinc-500">
              Se lee y se descarta: el PDF no se almacena. Hasta {MAX_PDF_BYTES / (1024 * 1024)} MB.
            </p>
          </div>
        </div>
        <form action={formAction} onSubmit={onSubmit} className="flex w-full flex-wrap items-center gap-2 lg:w-[26rem] lg:flex-none">
          <input
            id={inputId}
            name="archivo"
            type="file"
            accept="application/pdf,.pdf"
            required
            disabled={isPending}
            onChange={handleChange}
            className="peer sr-only"
          />
          <label
            htmlFor={inputId}
            aria-disabled={isPending || undefined}
            className="btn btn-secondary min-w-0 flex-1 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-brand)]"
          >
            {isPending ? <span className="spinner" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {isPending ? "Leyendo PDF…" : importando ? "Elegir otro PDF" : "Seleccionar PDF"}
          </label>
          {importando ? (
            <button type="button" onClick={onDescartar} className="btn btn-ghost">
              <X className="size-4" aria-hidden />
              Descartar
            </button>
          ) : null}
          <p role="status" className="sr-only">
            {isPending ? "Leyendo el PDF…" : ""}
          </p>
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
