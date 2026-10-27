/**
 * Read-only breakdown of one cotización (FASE 7 point 7.4): línea, droga, cantidad, partida, costo unitario, subtotal,
 * margen del tramo aplicado, precio final (and whether the precio mínimo raised it), flags parcial/incompleta.
 * The precio final leads (it is what the counter quotes); costo and margen explain it. Server Component (no interactivity).
 */
import { ToneBadge } from "@/shared/ui/status-badge";
import { formatNumero } from "@/shared/format/cantidad";
import { formatearCostoUnitario, formatearMonto } from "@/shared/format/monto";
import { formatFechaIso } from "@/shared/format/fecha";
import { dec } from "@/shared/decimal";
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

/** "Faltan 5 g": the shortage in the línea's unit. */
function textoFaltante(linea: LineaCotizacion): string {
  return `${formatNumero(linea.faltante ?? "0")} ${linea.unidadSimbolo}`;
}

/**
 * `PROVEEDOR` línea (R25, R32): who and at what list price it was quoted, and the arithmetic of its subtotal. The
 * subtotal's per-unit factor is the implied cost per the línea's unit (subtotal / cantidad), so it reads in the same
 * unit as the quantity next to it whatever the droga's unidad base is. A faltante is information, not a failure (R28).
 */
function CostoProveedorLinea({ linea }: { linea: LineaCotizacion }) {
  const costo = linea.costoProveedor;
  const cantidad = linea.cantidadRequerida !== null ? dec(linea.cantidadRequerida) : null;
  const costoPorUnidadLinea = cantidad !== null && cantidad.greaterThan(0) ? dec(linea.subtotal).dividedBy(cantidad).toString() : null;
  return (
    <div className="flex flex-col gap-0.5 text-xs text-zinc-600">
      <span className="font-medium text-zinc-800">
        Costo de proveedor
        {costo ? (
          <>
            {" · "}
            {costo.proveedorNombre}
            {" · "}
            <span className="whitespace-nowrap font-mono tabular-nums">
              ${formatearMonto(costo.precioInformado)} / {costo.unidadPrecioSimbolo}
              {costo.alicuotaIva !== undefined ? ` + IVA ${formatNumero(costo.alicuotaIva, 2)}%` : null}
            </span>
            {" · "}
            <span className="whitespace-nowrap tabular-nums">{formatFechaIso(costo.fechaPrecio)}</span>
          </>
        ) : null}
      </span>
      {costoPorUnidadLinea !== null ? (
        <span className="font-mono tabular-nums md:whitespace-nowrap">
          {formatNumero(linea.cantidadRequerida ?? "0")} {linea.unidadSimbolo} × ${formatearCostoUnitario(costoPorUnidadLinea)} / {linea.unidadSimbolo} ={" "}
          <span className="text-zinc-900">${formatearMonto(linea.subtotal)}</span>
        </span>
      ) : null}
      {linea.faltante ? <span>Sin stock suficiente para prepararla (faltan {textoFaltante(linea)})</span> : null}
    </div>
  );
}

/** The "Partidas usadas" cell: the costo de proveedor or the partida breakdown (labelled, except for an old snapshot that never said). */
function OrigenCostoLinea({ linea }: { linea: LineaCotizacion }) {
  if (linea.fuente === "PROVEEDOR") return <CostoProveedorLinea linea={linea} />;
  // Only a línea that was really costed from partidas gets the label (not enrase manual / uncostable units), and an old snapshot never does.
  const etiquetada = linea.fuenteRegistrada && !linea.esEnraseManual && (linea.partidas.length > 0 || linea.faltante !== null);
  return (
    <>
      {etiquetada ? <span className="mb-0.5 block text-xs font-medium text-zinc-800">Costo de partidas (sin costo de proveedor)</span> : null}
      {linea.partidas.length === 0 ? <Vacio label="Sin partidas" /> : <PartidasLinea linea={linea} />}
    </>
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
  const hayProveedor = cotizacion.detalle.lineas.some((l) => l.fuente === "PROVEEDOR");
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
            {cotizacion.esIncompleta ? <ToneBadge tone="danger">Incompleta: stock insuficiente en alguna línea costeada con partidas</ToneBadge> : null}
          </div>
        ) : null}
      </div>

      <dl className="grid gap-5 border-b border-zinc-100 px-5 py-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <dt className="text-xs text-zinc-500">Precio final</dt>
          <dd className="mt-1 font-mono text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">${formatearMonto(cotizacion.precioFinal)}</dd>
          {cotizacion.precioMinimoAplicado ? <dd className="mt-1 text-xs text-zinc-500">Precio mínimo aplicado (el costo + margen quedaba por debajo)</dd> : null}
        </div>
        {cotizacion.costoInsumosConIva !== null ? (
          <div>
            <dt className="text-xs text-zinc-500">Costo insumos con IVA</dt>
            <dd className="mt-1 font-mono text-lg font-medium text-zinc-900 tabular-nums">${formatearMonto(cotizacion.costoInsumosConIva)}</dd>
            <dd className="mt-1 font-mono text-xs text-zinc-500 tabular-nums">sin IVA ${formatearMonto(cotizacion.costoInsumos)}</dd>
          </div>
        ) : (
          <div>
            <dt className="text-xs text-zinc-500">Costo insumos (sin IVA)</dt>
            <dd className="mt-1 font-mono text-lg font-medium text-zinc-900 tabular-nums">${formatearMonto(cotizacion.costoInsumos)}</dd>
          </div>
        )}
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
                {hayProveedor ? "Origen del costo" : "Partidas usadas"}
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
                  {linea.fuente === "PROVEEDOR" ? (
                    // The faltante of a línea costed from a proveedor is informational: it travels inside its note, not as a red alert.
                    <span className="mt-1 block md:hidden">
                      <OrigenCostoLinea linea={linea} />
                    </span>
                  ) : (
                    <>
                      {linea.faltante ? (
                        <span className="block whitespace-nowrap text-xs font-medium text-red-700 sm:hidden">
                          Faltan {formatNumero(linea.faltante)} {linea.unidadSimbolo}
                        </span>
                      ) : null}
                      {linea.partidas.length > 0 ? (
                        <span className="mt-1 block md:hidden">
                          <OrigenCostoLinea linea={linea} />
                        </span>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="hidden px-3 py-2.5 text-right sm:table-cell">
                  <CantidadLinea linea={linea} />
                </td>
                <td className="hidden px-3 py-2.5 md:table-cell">
                  <OrigenCostoLinea linea={linea} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">
                  {/* R7a: a snapshot from before migration 0107 has no IVA and shows its net subtotal as always. */}
                  {linea.subtotalConIva !== undefined ? (
                    <>
                      ${formatearMonto(linea.subtotalConIva)}
                      <span className="block text-xs font-normal text-zinc-500">
                        sin IVA ${formatearMonto(linea.subtotal)} · IVA {formatNumero(linea.alicuotaIva ?? "0", 2)}%
                      </span>
                    </>
                  ) : (
                    <>${formatearMonto(linea.subtotal)}</>
                  )}
                </td>
                <td className="hidden whitespace-nowrap px-5 py-2.5 text-right font-mono tabular-nums sm:table-cell">
                  {linea.faltante ? (
                    <span className={linea.fuente === "PROVEEDOR" ? "text-zinc-600" : "font-medium text-red-700"}>{textoFaltante(linea)}</span>
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
