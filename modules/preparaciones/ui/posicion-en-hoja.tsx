"use client";

/**
 * "Posición en la hoja" (docs/specs/hoja-etiquetas.md R8, R9): the cell of the sheet an
 * etiqueta is printed in. A clickable grid drawn in the SHEET's proportions with one cell per
 * position that fits (the grid is anchored at the sheet's margin, cells touch, leftover space goes
 * to the right and bottom -- the same geometry as `posicionCelda`, so what the user sees is what
 * prints), the summary "N columnas × M filas · K etiquetas por hoja" and the chosen position as text.
 *
 * Accessible radio group: every cell is a radio labelled "Columna c, fila f" with a roving tab
 * stop (the chosen cell is the one in the tab order), the arrow keys move the selection (and the
 * focus) across the grid, and the chosen cell is visibly filled.
 *
 * Controlled: the parent owns the cell and keeps it inside the grid (`conservarCelda`) when the size
 * changes; a stale cell is drawn as 1 / 1 here too. Plain numbers only (no Prisma `Decimal`).
 */
import { useRef, type KeyboardEvent } from "react";
import { celdaValida, conservarCelda, formatearCelda, grillaHoja, resumenGrilla } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { Celda, HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { TamanoEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";

const MOVIMIENTOS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

export interface PosicionEnHojaProps {
  hoja: HojaEtiqueta;
  tamano: TamanoEtiqueta;
  celda: Celda;
  onChange: (celda: Celda) => void;
  /** Accessible name of the group; make it unique when several grids share a page (e.g. one per ítem). */
  etiqueta?: string;
  /** A smaller drawing, for rows of a list. */
  compacto?: boolean;
}

/** Drawing width, by the sheet's orientation: portrait sheets are narrower than landscape ones. */
function anchoDelDibujo(hoja: HojaEtiqueta, compacto: boolean): string {
  const apaisada = hoja.anchoMm >= hoja.altoMm;
  if (compacto) return apaisada ? "11rem" : "8rem";
  return apaisada ? "20rem" : "14rem";
}

export function PosicionEnHoja({ hoja, tamano, celda, onChange, etiqueta = "Posición en la hoja", compacto = false }: PosicionEnHojaProps) {
  const grillaRef = useRef<HTMLDivElement>(null);
  const grilla = grillaHoja(hoja, tamano);
  const elegida = conservarCelda(grilla, celda);

  if (grilla.columnas < 1 || grilla.filas < 1) return null;

  const porcentaje = (mm: number, total: number) => `${(mm / total) * 100}%`;

  function elegir(nueva: Celda, enfocar: boolean) {
    if (!celdaValida(grilla, nueva)) return;
    onChange(nueva);
    if (enfocar) grillaRef.current?.querySelector<HTMLElement>(`[data-celda="${nueva.columna}-${nueva.fila}"]`)?.focus();
  }

  function alPresionarTecla(evento: KeyboardEvent<HTMLDivElement>) {
    const movimiento = MOVIMIENTOS[evento.key];
    if (!movimiento) return;
    evento.preventDefault();
    const columna = Math.min(Math.max(elegida.columna + movimiento[0], 1), grilla.columnas);
    const fila = Math.min(Math.max(elegida.fila + movimiento[1], 1), grilla.filas);
    elegir({ columna, fila }, true);
  }

  const celdas: Celda[] = [];
  for (let fila = 1; fila <= grilla.filas; fila++) for (let columna = 1; columna <= grilla.columnas; columna++) celdas.push({ columna, fila });

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative w-full border border-zinc-300 bg-white shadow-sm dark:border-zinc-600 dark:bg-zinc-950"
        style={{ aspectRatio: `${hoja.anchoMm} / ${hoja.altoMm}`, maxWidth: anchoDelDibujo(hoja, compacto) }}
      >
        <div
          ref={grillaRef}
          role="radiogroup"
          aria-label={etiqueta}
          onKeyDown={alPresionarTecla}
          className="absolute grid"
          style={{
            left: porcentaje(hoja.margenMm, hoja.anchoMm),
            top: porcentaje(hoja.margenMm, hoja.altoMm),
            width: porcentaje(grilla.columnas * tamano.anchoMm, hoja.anchoMm),
            height: porcentaje(grilla.filas * tamano.altoMm, hoja.altoMm),
            gridTemplateColumns: `repeat(${grilla.columnas}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grilla.filas}, minmax(0, 1fr))`,
          }}
        >
          {celdas.map((c) => {
            const marcada = c.columna === elegida.columna && c.fila === elegida.fila;
            return (
              <button
                key={`${c.columna}-${c.fila}`}
                type="button"
                role="radio"
                aria-checked={marcada}
                aria-label={formatearCelda(c)}
                data-celda={`${c.columna}-${c.fila}`}
                tabIndex={marcada ? 0 : -1}
                onClick={() => elegir(c, false)}
                className={`min-h-0 min-w-0 border p-0 outline-offset-1 ${
                  marcada
                    ? "border-primary bg-primary"
                    : "border-zinc-300 bg-white hover:bg-emerald-50 dark:border-zinc-600 dark:bg-zinc-950 dark:hover:bg-zinc-800"
                }`}
              />
            );
          })}
        </div>
      </div>
      <p className="text-xs text-zinc-500">{resumenGrilla(grilla)}</p>
      <p className="text-sm font-medium" aria-live="polite">
        {formatearCelda(elegida)}
      </p>
    </div>
  );
}
