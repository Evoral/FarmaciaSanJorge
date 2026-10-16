"use client";

/**
 * "Ver" on a /preparaciones "Descartadas" row: a read-only summary of the discarded preparación (what the detail page
 * shows for it, with the row's data), in a native `<dialog>` like ./ver-receta-pendiente-dialog.tsx. Plain data only:
 * the page has already read everything (no client fetch).
 */
import { useId, useRef } from "react";
import { CircleOff } from "lucide-react";

export interface PreparacionDescartadaVista {
  recetaNumeroInterno: string;
  paciente: string;
  item: string;
  /** Already formatted in the farmacia's time zone. */
  iniciada: string;
}

export function VerPreparacionDescartadaDialog({ preparacion }: { preparacion: PreparacionDescartadaVista }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const presionoFondoRef = useRef(false);
  const tituloId = useId();

  function abrir() {
    dialogRef.current?.showModal();
    cerrarRef.current?.focus();
  }

  function cerrar() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button type="button" onClick={abrir} aria-haspopup="dialog" aria-label={`Ver preparación descartada de la receta Nº ${preparacion.recetaNumeroInterno}`} className="btn btn-secondary btn-sm">
        Ver
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={tituloId}
        // Close on the backdrop only when the press AND the click both landed there (a text-selection drag released over it must not close).
        onPointerDown={(event) => {
          presionoFondoRef.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          const cerrarPorFondo = presionoFondoRef.current && event.target === event.currentTarget;
          presionoFondoRef.current = false;
          if (cerrarPorFondo) cerrar();
        }}
        className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="p-5">
          <h2 id={tituloId} className="mb-3 text-lg font-semibold">
            Receta Nº {preparacion.recetaNumeroInterno}
          </h2>

          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-xs text-zinc-500">Paciente</dt>
            <dd className="text-zinc-900">{preparacion.paciente}</dd>
            <dt className="text-xs text-zinc-500">Ítem</dt>
            <dd className="text-zinc-900">{preparacion.item}</dd>
            <dt className="text-xs text-zinc-500">Iniciada</dt>
            <dd className="text-zinc-900 tabular-nums">{preparacion.iniciada}</dd>
          </dl>

          <div role="note" className="flex items-start gap-3 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
            <CircleOff className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            <div>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Esta preparación fue descartada</p>
              <p className="text-zinc-500">No afectó el stock ni el libro recetario.</p>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button ref={cerrarRef} type="button" onClick={cerrar} className="btn btn-secondary btn-sm">
              Cerrar
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
