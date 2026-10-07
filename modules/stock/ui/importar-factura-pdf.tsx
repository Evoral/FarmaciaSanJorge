"use client";

/**
 * "Importar factura" (/stock/ingresar): uploads the supplier invoice PDF to
 * `leerFacturaCompraPdfAction` (the file is read in memory and discarded,
 * nothing is saved) and hands the preview to the parent, which swaps the
 * manual form for the import form. Same interaction as the receta import
 * (modules/recetas/ui/importar-receta-pdf.tsx): reading starts as soon as a
 * file is picked. The size pre-check is only for a clearer message.
 */
import { useActionState, useEffect, useId, useState, type ChangeEvent } from "react";
import { AlertCircle, FileText, Upload, X } from "lucide-react";
import { leerFacturaCompraPdfAction } from "./actions";
import { IDLE_LEER_FACTURA_STATE } from "./action-state";
import { MAX_FACTURA_PDF_BYTES, MENSAJES_ARCHIVO_FACTURA } from "../domain/factura-compra-pdf-parser";
import type { VistaPreviaFactura } from "../domain/importacion-factura-compra";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

export interface ImportarFacturaPdfProps {
  onLeida: (vistaPrevia: VistaPreviaFactura) => void;
  onDescartar: () => void;
  importando: boolean;
}

export function ImportarFacturaPdf({ onLeida, onDescartar, importando }: ImportarFacturaPdfProps) {
  const [state, formAction, isPending] = useActionState(leerFacturaCompraPdfAction, IDLE_LEER_FACTURA_STATE);
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
    if (archivo.size > MAX_FACTURA_PDF_BYTES) {
      setClientError(MENSAJES_ARCHIVO_FACTURA.demasiadoGrande);
      e.target.value = "";
      return;
    }
    setClientError(null);
    e.target.form?.requestSubmit();
  }

  return (
    <section aria-labelledby="importar-factura-heading" className="panel">
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="tone-tile" data-tone={importando ? "success" : "neutral"} aria-hidden>
            <FileText />
          </span>
          <div className="min-w-0">
            <h2 id="importar-factura-heading" className="text-sm font-semibold text-zinc-900">
              {importando ? "Factura importada desde PDF" : "¿Tenés la factura del proveedor? Importá el PDF"}
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-zinc-500">
              Carga todas las drogas y lotes de la factura. No se guarda nada hasta que confirmes, y el PDF no se almacena.
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
