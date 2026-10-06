"use client";

/**
 * "Imprimir etiqueta": the button opens a "Seleccionar tamaño" dialog with the
 * sizes the administrator configured (modules/etiqueta-tamanos); confirming
 * opens the etiqueta PDF, rendered on that page size, in a new tab. Native
 * `<dialog>` opened with `showModal()` (same pattern as
 * `./ver-receta-pendiente-dialog.tsx`): focus is trapped and returned to the
 * trigger by the browser, Escape closes it natively, and a click on the
 * backdrop closes it too.
 *
 * Plain data only: the page has already read the sizes (no client fetch), as
 * plain numbers -- never Prisma `Decimal`s, which can not cross into a client
 * component.
 */
import { useId, useRef, useState } from "react";
import { Printer, TriangleAlert } from "lucide-react";
import { formatearTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { hrefEtiquetaPdf } from "../domain/etiqueta";

export interface ImprimirEtiquetaDialogProps {
  preparacionId: string;
  tamanos: readonly EtiquetaTamano[];
  /** `"secondary"` + `small` in table rows, `"primary"` on the preparación screen. Defaults to the row style. */
  variant?: "primary" | "secondary";
  small?: boolean;
}

export function ImprimirEtiquetaDialog({ preparacionId, tamanos, variant = "secondary", small = true }: ImprimirEtiquetaDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tituloId = useId();
  const selectId = useId();
  const [elegido, setElegido] = useState("");

  // The first size is preselected; a stale choice (the list changed meanwhile) falls back to it.
  const tamanoId = tamanos.some((t) => t.id === elegido) ? elegido : (tamanos[0]?.id ?? "");
  const sinTamanos = tamanos.length === 0;

  function abrir() {
    dialogRef.current?.showModal();
  }

  function cerrar() {
    dialogRef.current?.close();
  }

  function imprimir() {
    if (!tamanoId) return;
    window.open(hrefEtiquetaPdf(preparacionId, tamanoId), "_blank", "noreferrer");
    cerrar();
  }

  return (
    <>
      <button type="button" onClick={abrir} aria-haspopup="dialog" className={`btn ${variant === "primary" ? "btn-primary" : "btn-secondary"}${small ? " btn-sm" : ""}`}>
        <Printer className={small ? "size-3.5" : "size-4"} aria-hidden />
        Imprimir etiqueta
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={tituloId}
        // The content wrapper fills the dialog, so a click whose target is the dialog itself landed on the backdrop.
        onClick={(event) => {
          if (event.target === event.currentTarget) cerrar();
        }}
        className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="p-5">
          <h2 id={tituloId} className="mb-3 text-lg font-semibold">
            Seleccionar tamaño
          </h2>

          {sinTamanos ? (
            <div role="note" className="alert alert-warn">
              <TriangleAlert aria-hidden />
              <p>No hay tamaños de etiqueta configurados. Solicite al administrador que cargue uno.</p>
            </div>
          ) : (
            <div className="field">
              <label htmlFor={selectId} className="field-label">
                Tamaño
              </label>
              <select id={selectId} value={tamanoId} onChange={(event) => setElegido(event.target.value)} className="input">
                {tamanos.map((tamano) => (
                  <option key={tamano.id} value={tamano.id}>
                    {formatearTamano(tamano)}
                  </option>
                ))}
              </select>
              <p className="field-help">La etiqueta se escala proporcionalmente al tamaño elegido.</p>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={cerrar} className="btn btn-secondary btn-sm">
              Cancelar
            </button>
            <button type="button" onClick={imprimir} disabled={sinTamanos} className="btn btn-primary btn-sm">
              Imprimir
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
