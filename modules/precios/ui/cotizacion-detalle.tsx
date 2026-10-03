/**
 * Read-only breakdown of one cotización (FASE 7 point 7.4): línea, droga, cantidad, partida, costo unitario, subtotal,
 * margen del tramo aplicado, precio final (and whether the precio mínimo raised it), flags parcial/incompleta.
 * The precio final leads (it is what the counter quotes); costo and margen explain it. Server Component (no interactivity).
 */
import { ToneBadge } from "@/shared/ui/status-badge";
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
          <dd className="mt-1 font-mono text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">${cotizacion.precioFinal}</dd>
          {cotizacion.precioMinimoAplicado ? <dd className="mt-1 text-xs text-zinc-500">Precio mínimo aplicado (el costo + margen quedaba por debajo)</dd> : null}
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Costo insumos</dt>
          <dd className="mt-1 font-mono text-lg font-medium text-zinc-900 tabular-nums">${cotizacion.costoInsumos}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Margen del tramo</dt>
          <dd className="mt-1 font-mono text-lg font-medium text-zinc-900 tabular-nums">{cotizacion.margenAplicado}%</dd>
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
              <th scope="col" className="px-3 py-2 text-right">
                Cantidad
              </th>
              <th scope="col" className="px-3 py-2">
                Partidas usadas
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Subtotal
              </th>
              <th scope="col" className="px-5 py-2 text-right">
                Faltante
              </th>
            </tr>
          </thead>
          <tbody>
            {cotizacion.detalle.lineas.map((linea) => (
              <tr key={linea.orden} className="align-top">
                <td className="px-5 py-2.5 font-medium text-zinc-900">{linea.drogaNombre}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                  {linea.esEnraseManual ? (
                    <span className="font-sans text-zinc-500">Enrase manual (sin costo)</span>
                  ) : (
                    <>
                      {linea.cantidadRequerida} <span className="text-zinc-500">{linea.unidadSimbolo}</span>
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {linea.partidas.length === 0 ? (
                    <Vacio label="Sin partidas" />
                  ) : (
                    <ul className="flex flex-col gap-0.5 font-mono text-xs text-zinc-600 tabular-nums">
                      {linea.partidas.map((p) => (
                        <li key={p.partidaId}>
                          {p.cantidad} × ${p.costoUnitario} = <span className="text-zinc-900">${p.subtotal}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">${linea.subtotal}</td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right font-mono tabular-nums">
                  {linea.faltante ? (
                    <span className="font-medium text-red-700">
                      {linea.faltante} {linea.unidadSimbolo}
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
