/**
 * One proveedor of the "Comparador de costos" as a row of the comparison table
 * (docs/specs/comparador-costos.md). Two server components feed
 * `shared/ui/fila-desplegable.tsx` (the only client piece, which just holds
 * the open/closed state): `ComparadorCeldas` renders the summary cells and
 * `ComparadorDetalle` the expanded body (that proveedor's partidas for the
 * droga in the period).
 *
 * Summary cells carry no links on purpose (the whole row toggles on click); the
 * link to `/stock/partidas/[id]` lives in the detail and exists only with
 * `linkPartida` (`stock.ver`, decided by the use case). Money never wraps
 * mid-number (`whitespace-nowrap`). The ranking bar is decoration: a div whose
 * width is a percentage of the largest último costo, hidden from assistive
 * technology, with the figure always written as text next to it.
 *
 * Costs arrive already converted to the display unit (decimal strings);
 * `formatearCostoUnitario` only formats them.
 */
import Link from "next/link";
import { formatCantidad, formatNumero } from "@/shared/format/cantidad";
import type { CatalogoUnidades } from "@/shared/format/cantidad";
import { formatFecha } from "@/shared/format/fecha";
import { formatearCostoUnitario } from "@/shared/format/monto";
import { Cantidad } from "@/shared/ui/cantidad";
import { ToneBadge } from "@/shared/ui/status-badge";
import type { ComparacionCostos, FilaProveedorComparador } from "../domain/comparador-costos";

/** Toggle + proveedor, último costo, última compra, diferencia, promedio ponderado, mín - máx, partidas. */
export const COLUMNAS_COMPARADOR = 8;

/** Accessible name of a row (completes the toggle button's label). */
export function etiquetaProveedorComparador(fila: FilaProveedorComparador): string {
  return `proveedor ${fila.razonSocial}`;
}

// Non-breaking space: "$" never ends a line apart from its figure.
const dinero = (valor: string) => `$\u00a0${formatearCostoUnitario(valor)}`;

function Sin() {
  return <span className="text-zinc-500">—</span>;
}

function InsigniasProveedor({ fila }: { fila: FilaProveedorComparador }) {
  return (
    <>
      {fila.esMasBarato ? (
        <ToneBadge tone="success" title="Menor último costo entre los proveedores vigentes">
          Más barato
        </ToneBadge>
      ) : null}
      {fila.deBaja ? (
        <ToneBadge tone="neutral" title="Proveedor dado de baja: se muestra pero no entra en el ranking">
          De baja
        </ToneBadge>
      ) : null}
      {fila.esAntiguo ? (
        <ToneBadge tone="warn" title="La última compra tiene más de 12 meses">
          Antiguo
        </ToneBadge>
      ) : null}
      {fila.revisar ? (
        <ToneBadge tone="warn" title="Tiene partidas con un costo muy distinto del resto (más de 10 veces o menos de la décima parte de la mediana). Puede ser un error de unidad al cargarlo.">
          Revisar
        </ToneBadge>
      ) : null}
    </>
  );
}

function BarraCosto({ porcentaje, deBaja }: { porcentaje: string; deBaja: boolean }) {
  return (
    <div aria-hidden="true" className="mt-1 h-1.5 w-full min-w-24 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
      <div className={`h-full rounded ${deBaja ? "bg-zinc-400 dark:bg-zinc-600" : "bg-(--color-brand)"}`} style={{ width: `${porcentaje}%` }} />
    </div>
  );
}

/** The summary `<td>`s of a proveedor row, in the table's column order (after the toggle cell). */
export function ComparadorCeldas({ fila, zonaHoraria }: { fila: FilaProveedorComparador; zonaHoraria: string }) {
  const apagada = fila.deBaja ? "text-zinc-500 dark:text-zinc-500" : "";
  const diferencia = fila.diferencia;

  return (
    <>
      <td className={`min-w-0 px-3 py-2 ${apagada}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 font-medium break-words">{fila.razonSocial}</span>
          <InsigniasProveedor fila={fila} />
        </div>
      </td>
      <td className={`px-3 py-2 ${apagada}`}>
        {fila.ultimoCosto !== null ? (
          <>
            <span className="whitespace-nowrap font-medium">{dinero(fila.ultimoCosto)}</span>
            {fila.barraPorcentaje !== null ? <BarraCosto porcentaje={fila.barraPorcentaje} deBaja={fila.deBaja} /> : null}
          </>
        ) : (
          <Sin />
        )}
      </td>
      <td className={`px-3 py-2 whitespace-nowrap ${apagada}`}>{fila.ultimaCompra ? formatFecha(fila.ultimaCompra, zonaHoraria) : <Sin />}</td>
      <td className={`px-3 py-2 whitespace-nowrap ${apagada}`}>
        {diferencia ? (
          <>
            +{dinero(diferencia.monto)} <span className="text-zinc-500">(+{formatNumero(diferencia.porcentaje, 2)} %)</span>
          </>
        ) : (
          <Sin />
        )}
      </td>
      <td className={`px-3 py-2 whitespace-nowrap ${apagada}`}>{fila.promedioPonderado !== null ? dinero(fila.promedioPonderado) : <Sin />}</td>
      <td className={`px-3 py-2 whitespace-nowrap ${apagada}`}>
        {fila.costoMin !== null && fila.costoMax !== null ? `${dinero(fila.costoMin)} – ${dinero(fila.costoMax)}` : <Sin />}
      </td>
      <td className={`px-3 py-2 whitespace-nowrap ${apagada}`}>
        {fila.partidasTotal}
        {fila.partidasCostoCero > 0 ? <span className="block text-xs text-zinc-500">{fila.partidasCostoCero} con costo $&nbsp;0</span> : null}
      </td>
    </>
  );
}

/** The expanded body of a proveedor row: its partidas of the droga in the period, newest first. */
export function ComparadorDetalle({
  fila,
  comparacion,
  catalogo,
  linkPartida,
}: {
  fila: FilaProveedorComparador;
  comparacion: ComparacionCostos;
  catalogo: CatalogoUnidades;
  linkPartida: boolean;
}) {
  const unidadBase = { id: comparacion.unidadBase.id, simbolo: comparacion.unidadBase.simbolo };

  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold">Partidas de {fila.razonSocial}</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Ingreso</th>
              <th scope="col" className="px-3 py-2 font-medium">Lote</th>
              <th scope="col" className="px-3 py-2 font-medium">Cantidad inicial</th>
              <th scope="col" className="px-3 py-2 font-medium">Costo por {comparacion.unidadMostrada.simbolo}</th>
              <th scope="col" className="px-3 py-2 font-medium">Observación</th>
              {linkPartida ? (
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Partida</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {fila.partidas.map((partida) => (
              <tr key={partida.id} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap">{formatFecha(partida.fechaIngreso, comparacion.zonaHoraria)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{partida.lote}</td>
                <td className="px-3 py-2">
                  <Cantidad valor={formatCantidad(partida.cantidadInicial, unidadBase, catalogo)} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{dinero(partida.costo)}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-1">
                    {partida.atipica ? (
                      <ToneBadge tone="warn" title="Costo muy distinto de la mediana de la droga en el período">
                        Revisar
                      </ToneBadge>
                    ) : null}
                    {partida.costoCero ? <span className="text-xs text-zinc-500">Costo $&nbsp;0: no se considera</span> : null}
                    {!partida.atipica && !partida.costoCero ? <Sin /> : null}
                  </span>
                </td>
                {linkPartida ? (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={`/stock/partidas/${partida.id}`} className="underline underline-offset-2" aria-label={`Ver partida lote ${partida.lote}`}>
                      Ver partida
                    </Link>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fila.partidasHayMas ? (
        <p className="mt-2 text-xs text-zinc-500">
          Mostrando {fila.partidas.length} de {fila.partidasTotal} partidas (las más recientes).
          {fila.revisar ? " Hay partidas marcadas «Revisar» en este proveedor: las marcadas pueden ser de las más antiguas, que no se muestran aquí." : ""}
        </p>
      ) : null}
    </div>
  );
}
