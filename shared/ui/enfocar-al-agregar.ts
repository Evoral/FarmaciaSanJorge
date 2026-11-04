"use client";

/**
 * Rule (AGENTS.md): every "Agregar ..." button leaves the cursor in the first field of what it added, so the user
 * types right away instead of clicking the new field first.
 *
 *   onClick={() => agregarYEnfocar(agregarItem, () => filaDeLista("receta-item"))}
 *
 * `agregar` runs inside `flushSync`, so the new row is in the DOM when `destino` looks it up. Rows are marked with
 * `data-fila="<lista>"`; `filaDeLista` returns the last one (or the one at `indice`, e.g. -2 when the new row goes
 * before a fixed last one).
 */
import { flushSync } from "react-dom";

const CAMPO = 'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])';

export function agregarYEnfocar(agregar: () => void, destino: () => Element | null | undefined): void {
  flushSync(agregar);
  const elemento = destino();
  if (!elemento) return;
  const campo = elemento.matches(CAMPO) ? elemento : elemento.querySelector(CAMPO);
  if (campo instanceof HTMLElement) campo.focus();
}

/** The row of the `data-fila="<lista>"` list at `indice` (negative counts from the end; default the last one). */
export function filaDeLista(lista: string, indice = -1): Element | undefined {
  return Array.from(document.querySelectorAll(`[data-fila="${CSS.escape(lista)}"]`)).at(indice);
}
