"use client";

/**
 * One expandable row of a `table.data-table`: a summary row (a toggle cell
 * followed by the caller's cells) and, while open, a full-width detail row
 * right below it. The ONLY client state is the open/closed boolean (closed by
 * default); `celdas` and `detalle` are rendered on the server by the caller and
 * arrive here as already-rendered output, so nothing they import ends up in
 * the client bundle.
 *
 * Interaction: the toggle button (first cell) is the keyboard / screen-reader
 * entry point (Enter/Space are native). Clicking anywhere else on the summary
 * row toggles too, except when the click originates inside a link, another
 * button or an input, so interactive content in `celdas` keeps working.
 *
 * Must be rendered directly inside a `<tbody>`: it returns a fragment of one
 * or two `<tr>`s. `colSpan` is the TOTAL column count, toggle column included.
 */
import { useState, type MouseEvent, type ReactNode } from "react";

export interface FilaDesplegableProps {
  /** Stable id (e.g. the entity's uuid); used to build the detail row id and the `aria-controls` link. */
  id: string;
  /** Summary `<td>`s, WITHOUT the toggle cell (this component renders it first). */
  celdas: ReactNode;
  /** Content of the detail row. */
  detalle: ReactNode;
  /** Total number of columns of the table, toggle column included. */
  colSpan: number;
  /** Accessible name of the row, e.g. "Receta Nº 123"; completes the toggle's label. */
  etiqueta: string;
}

/** DOM id of the detail row of the row `id`. */
export function idDetalleFila(id: string): string {
  return `fila-detalle-${id}`;
}

export function FilaDesplegable({ id, celdas, detalle, colSpan, etiqueta }: FilaDesplegableProps) {
  const [abierto, setAbierto] = useState(false);
  const detalleId = idDetalleFila(id);

  function alternarDesdeFila(event: MouseEvent<HTMLTableRowElement>) {
    const target = event.target;
    if (target instanceof Element) {
      const interactivo = target.closest("a, button, input");
      // The toggle button is the one interactive element that must still toggle (its click bubbles up to this handler).
      if (interactivo && !interactivo.hasAttribute("data-fila-toggle")) return;
    }
    setAbierto((actual) => !actual);
  }

  return (
    <>
      <tr className="cursor-pointer align-top" onClick={alternarDesdeFila}>
        <td className="w-8 px-3 py-2">
          <button
            type="button"
            data-fila-toggle=""
            aria-expanded={abierto}
            aria-controls={detalleId}
            aria-label={`${abierto ? "Ocultar" : "Ver"} detalle de ${etiqueta}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <span aria-hidden="true" className={`transition-transform ${abierto ? "rotate-90" : ""}`}>
              ▸
            </span>
          </button>
        </td>
        {celdas}
      </tr>
      {abierto ? (
        <tr id={detalleId}>
          <td colSpan={colSpan} className="border-t border-zinc-200 bg-zinc-50 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
            {detalle}
          </td>
        </tr>
      ) : null}
    </>
  );
}
