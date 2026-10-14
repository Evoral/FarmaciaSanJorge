/**
 * Read-only breakdown of one cotización (FASE 7 point 7.4): línea, droga, cantidad, partida, costo unitario, subtotal,
 * margen del tramo aplicado, precio final (and whether the precio mínimo raised it), flags parcial/incompleta.
 * The precio final leads (it is what the counter quotes); costo and margen explain it. Server Component (no interactivity).
 */
import { ToneBadge } from "@/shared/ui/status-badge";
import { formatNumero } from "@/shared/format/cantidad";
import { formatearCostoUnitario, formatearMonto } from "@/shared/format/monto";
import type { CotizacionItemOutput } from "@/modules/precios/application/get-cotizacion-item";

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function Vacio({ label }: { label: string }) {
  return (
    <span className="text-zinc-400">
      -<span className="sr-only">{label}</span>
    </span>
  );
}

type LineaCotizacion = CotizacionItemOutput["detalle"]["lineas"][number];

/** The quantity stays on one line; the enrase-manual note is free text and may wrap. */
function CantidadLinea({ linea }: { linea: LineaCotizacion }) {
  if (linea.esEnraseManual) return <span className="text-zinc-500">Enrase manual (sin costo)</span>;
  return (
    <span className="whitespace-nowrap font-mono tabular-nums">
      {linea.cantidadRequerida !== null ? formatNumero(linea.cantidadRequerida) : null} <span className="text-zinc-500">{linea.unidadSimbolo}</span>
    </span>
  );
}

function PartidasLinea({ linea }: { linea: LineaCotizacion }) {
  return (
    <ul className="flex flex-col gap-0.5 font-mono text-xs text-zinc-600 tabular-nums">
      {linea.partidas.map((p) => (
        // One line from md up; on phones it may only break before the "=".
        <li key={p.partidaId} className="md:whitespace-nowrap">
          <span className="whitespace-nowrap">
            {formatNumero(p.cantidad)} × ${formatearCostoUnitario(p.costoUnitario)}
          </span>{" "}
          <span className="whitespace-nowrap">
            = <span className="text-zinc-900">${formatearMonto(p.subtotal)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CotizacionDetalleView({ cotizacion }: { cotizacion: CotizacionItemOutput }) {
  return (
    <section className="panel" aria-labelledby="cotizacion-vigente-heading">
      <div className="panel-header flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="cotizacion-vigente-heading">Cotización vigente</h2>
          <p>
            Calculada el <span className="tabular-nums">{fechaHora(cotizacion.calculadaEn)}</span> por {cotizacion.calculadaPorApellido}, {cotizacion.calculadaPorNombre}
          </p>
        </div>
        {cotizacion.esParcial || cotizacion.esIncompleta ? (
          <div className="flex flex-wrap gap-2">
            {cotizacion.esParcial ? <ToneBadge tone="warn">Parcial: hay líneas de enrase manual sin costo</ToneBadge> : null}
            {cotizacion.esIncompleta ? <ToneBadge tone="danger">Incompleta: stock insuficiente en alguna línea</ToneBadge> : null}
          </div>
        ) : null}
      </div>

      <dl className="grid gap-5 border-b border-zinc-100 px-5 py-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <dt className="text-xs text-zinc-500">Precio final</dt>
          <dd className="mt-1 font-mono text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">${formatearMonto(cotizacion.precioFinal)}</dd>
          {cotizacion.precioMinimoAplicado ? <dd className="mt-1 text-xs text-zinc-500">Precio mínimo aplicado (el costo + margen quedaba por debajo)</dd> : null}
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Costo insumos</dt>
          <dd className="mt-1 font-mono text-lg font-medium text-zinc-900 tabular-nums">${formatearMonto(cotizacion.costoInsumos)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Margen del tramo</dt>
          <dd className="mt-1 font-mono text-lg font-medium text-zinc-900 tabular-nums">{formatNumero(cotizacion.margenAplicado, 2)}%</dd>
        </div>
      </dl>

      <div className="overflow-x-auto">
        <table className="data-table">
          <caption className="sr-only">Líneas de la cotización</caption>
          <thead>
            <tr>
              <th scope="col" className="px-5 py-2">
                Droga
              </th>
              <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">
                Cantidad
              </th>
              <th scope="col" className="hidden px-3 py-2 md:table-cell">
                Partidas usadas
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Subtotal
              </th>
              <th scope="col" className="hidden px-5 py-2 text-right sm:table-cell">
                Faltante
              </th>
            </tr>
          </thead>
          <tbody>
            {cotizacion.detalle.lineas.map((linea) => (
              <tr key={linea.orden} className="align-top">
                <td className="px-5 py-2.5">
                  <span className="block break-words font-medium text-zinc-900">{linea.drogaNombre}</span>
                  {/* Phones: the hidden columns travel under the droga. */}
                  <span className="block text-xs text-zinc-600 sm:hidden">
                    <CantidadLinea linea={linea} />
                  </span>
                  {linea.faltante ? (
                    <span className="block whitespace-nowrap text-xs font-medium text-red-700 sm:hidden">
                      Faltan {formatNumero(linea.faltante)} {linea.unidadSimbolo}
                    </span>
                  ) : null}
                  {linea.partidas.length > 0 ? (
                    <span className="mt-1 block md:hidden">
                      <PartidasLinea linea={linea} />
                    </span>
                  ) : null}
                </td>
                <td className="hidden px-3 py-2.5 text-right sm:table-cell">
                  <CantidadLinea linea={linea} />
                </td>
                <td className="hidden px-3 py-2.5 md:table-cell">{linea.partidas.length === 0 ? <Vacio label="Sin partidas" /> : <PartidasLinea linea={linea} />}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">${formatearMonto(linea.subtotal)}</td>
                <td className="hidden whitespace-nowrap px-5 py-2.5 text-right font-mono tabular-nums sm:table-cell">
                  {linea.faltante ? (
                    <span className="font-medium text-red-700">
                      {formatNumero(linea.faltante)} {linea.unidadSimbolo}
                    </span>
                  ) : (
                    <Vacio label="Sin faltante" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
