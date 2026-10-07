/**
 * One receta (that consumed the droga) of the Historial as a row of the recetas
 * table. Two server components feed `shared/ui/fila-desplegable.tsx` (the only
 * client piece, which just holds the open/closed state):
 * `HistorialRecetaCeldas` renders the summary cells (Nº, preparada, paciente,
 * médico, consumido, estado) and `HistorialRecetaDetalle` renders the expanded
 * body: one line per partida consumed by that receta (lote, proveedor,
 * vencimiento, quantity) plus the link to the receta and, with `acceso.stock`,
 * to each partida.
 *
 * The summary cells carry no links on purpose (the whole row toggles on click);
 * the links live in the detail. Quantities are always the droga's unidad base,
 * converted for display only with the unit catalog the page loads under
 * `stock.ver` (an empty catalog leaves them unconverted). The paciente cell is
 * "—" when the session lacks `pacientes.gestionar` (the name is not even
 * fetched). Quantities are never summed across drogas: everything here is one
 * droga, one unidad base.
 */
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatCantidad } from "@/shared/format/cantidad";
import type { CatalogoUnidades } from "@/shared/format/cantidad";
import { formatFecha, formatFechaHora } from "@/shared/format/fecha";
import { Cantidad } from "@/shared/ui/cantidad";
import { StatusBadge } from "@/shared/ui/status-badge";
import type { AccesoHistorialDroga, DrogaHistorial, RecetaHistorial } from "../domain/historial";

interface HistorialRecetaFilaProps {
  receta: RecetaHistorial;
  droga: DrogaHistorial;
  acceso: AccesoHistorialDroga;
  zonaHoraria: string;
  catalogo: CatalogoUnidades;
}

/** Total column count of the recetas table: toggle + Nº, Preparada, Paciente, Médico, Consumido, Estado. */
export const COLUMNAS_TABLA_HISTORIAL = 7;

/** Accessible name of a receta row (completes the toggle button's label). */
export function etiquetaReceta(receta: RecetaHistorial): string {
  return `Receta Nº ${receta.numeroInterno}`;
}

/** The summary `<td>`s of a receta row, in the table's column order (after the toggle cell). */
export function HistorialRecetaCeldas({ receta, droga, zonaHoraria, catalogo }: HistorialRecetaFilaProps) {
  const unidad = { id: droga.unidadBaseId, simbolo: droga.unidadBaseSimbolo };
  return (
    <>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono font-medium text-zinc-900">{receta.numeroInterno}</td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums">{receta.preparadaEn ? formatFechaHora(receta.preparadaEn, zonaHoraria) : "—"}</td>
      <td className="px-3 py-2.5">{receta.paciente ?? <span className="text-zinc-400">—</span>}</td>
      <td className="hidden px-3 py-2.5 md:table-cell">{receta.medico}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
        <Cantidad valor={formatCantidad(receta.consumido, unidad, catalogo)} />
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge estado={receta.estado} />
      </td>
    </>
  );
}

/** The expanded body of a receta row. */
export function HistorialRecetaDetalle({ receta, droga, acceso, catalogo }: HistorialRecetaFilaProps) {
  const unidad = { id: droga.unidadBaseId, simbolo: droga.unidadBaseSimbolo };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[0.8125rem] font-semibold text-zinc-900">Partidas consumidas</h3>
        <Link href={`/recetas/${receta.id}`} className="btn btn-secondary btn-sm">
          Ver receta
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {receta.partidas.length === 0 ? (
        <p className="text-sm text-zinc-500">Sin partidas registradas.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Lote</th>
                <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Proveedor</th>
                <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Vencimiento</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Consumido</th>
              </tr>
            </thead>
            <tbody>
              {receta.partidas.map((partida) => (
                <tr key={partida.partidaId} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono">
                    {acceso.stock ? (
                      <Link href={`/stock/partidas/${partida.partidaId}`} className="underline underline-offset-2">
                        {partida.lote}
                      </Link>
                    ) : (
                      partida.lote
                    )}
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">{partida.proveedor}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2 font-mono tabular-nums sm:table-cell">
                    {partida.fechaVencimiento ? formatFecha(partida.fechaVencimiento) : "No vence"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    <Cantidad valor={formatCantidad(partida.cantidad, unidad, catalogo)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
