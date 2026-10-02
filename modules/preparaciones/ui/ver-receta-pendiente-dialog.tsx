"use client";

/**
 * "Ver" on a /preparaciones "Pendientes" row: a read-only preview of what has to be prepared for the receta -- each of
 * its pending ítems (forma, cantidades, posología and componentes), worded like the receta detail page's ítem cards.
 * Native `<dialog>` opened with `showModal()`: focus is trapped and returned to "Ver" by the browser, Escape closes it
 * natively, and a click on the backdrop (the dialog element itself, outside the padded content) closes it too. Plain
 * data only: the page has already read everything (no client fetch).
 */
import { useId, useRef } from "react";
import { ItemDatos } from "./item-datos";
import type { ItemDatosVista } from "./item-datos";

export interface ItemPendienteVista extends ItemDatosVista {
  itemRecetaId: string;
  /** Descripción or forma farmacéutica, plus "(ítem N de M)". */
  nombre: string;
}

export interface RecetaPendienteVista {
  recetaNumeroInterno: string;
  items: readonly ItemPendienteVista[];
}

export function VerRecetaPendienteDialog({ receta }: { receta: RecetaPendienteVista }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
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
      <button type="button" onClick={abrir} aria-haspopup="dialog" aria-label={`Ver receta Nº ${receta.recetaNumeroInterno}`} className="btn btn-secondary btn-sm">
        Ver
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={tituloId}
        // The content wrapper fills the dialog, so a click whose target is the dialog itself landed on the backdrop.
        onClick={(event) => {
          if (event.target === event.currentTarget) cerrar();
        }}
        className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-2xl p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="p-5">
          <h2 id={tituloId} className="mb-3 text-lg font-semibold">
            Receta Nº {receta.recetaNumeroInterno}
          </h2>

          <div className="flex flex-col gap-5">
            {receta.items.map((item) => (
              <section key={item.itemRecetaId} aria-label={item.nombre}>
                <h3 className="mb-1 text-sm text-zinc-600 dark:text-zinc-400">{item.nombre}</h3>
                <ItemDatos item={item} />
              </section>
            ))}
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
