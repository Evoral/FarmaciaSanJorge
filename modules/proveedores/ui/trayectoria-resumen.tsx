/**
 * "Resumen" strip of the proveedor Trayectoria: counters over ALL the proveedor's partidas (not just the visible page),
 * one cell each in a single panel. The money row exists only when `resumen.totales` is present (the session holds
 * `stock.valorizado.ver`). Quantities are never summed across drogas (different unidad base), so there is no "total
 * stock" cell. Server component.
 *
 * Amounts are NEVER wrapped (splitting "265.872.439.326.000,00" across lines is unreadable): they live in their own,
 * wider row and use `whitespace-nowrap`; if one is still wider than its cell it scrolls inside the cell instead of
 * breaking. `min-w-0` lets a grid cell shrink below its content's width.
 */
import { formatFecha } from "@/shared/format/fecha";
import { formatearMonto } from "@/shared/format/monto";
import type { ResumenTrayectoriaProveedor } from "../domain/trayectoria";

const numberFormat = new Intl.NumberFormat("es-AR");

interface DatoProps {
  etiqueta: string;
  valor: string;
  /** Signal tone: a swatch next to the label (and red digits for danger). */
  tone?: "danger" | "warn";
  monto?: boolean;
  className?: string;
}

function Dato({ etiqueta, valor, tone, monto = false, className = "" }: DatoProps) {
  return (
    <div className={`min-w-0 bg-(--surface) px-4 py-3.5 ${className}`}>
      <dt className="flex items-center gap-1.5 text-xs text-zinc-500">
        {tone ? <span aria-hidden className={`swatch tone-${tone}`} /> : null}
        {etiqueta}
      </dt>
      <dd className={`summary-count mt-1.5 ${monto ? "overflow-x-auto whitespace-nowrap text-xl" : "[overflow-wrap:anywhere]"}`} data-tone={tone === "danger" ? "danger" : undefined}>
        {valor}
      </dd>
    </div>
  );
}

export function TrayectoriaResumen({ resumen, zonaHoraria }: { resumen: ResumenTrayectoriaProveedor; zonaHoraria: string }) {
  const { totales } = resumen;
  return (
    <section aria-labelledby="trayectoria-resumen" className="mb-6">
      <h2 id="trayectoria-resumen" className="sr-only">
        Resumen
      </h2>
      <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
        <dl className="grid grid-cols-2 gap-px md:grid-cols-5">
          <Dato etiqueta="Partidas" valor={numberFormat.format(resumen.partidas)} />
          <Dato etiqueta="Drogas distintas" valor={numberFormat.format(resumen.drogasDistintas)} />
          <Dato etiqueta="Último ingreso" valor={resumen.ultimoIngreso ? formatFecha(resumen.ultimoIngreso, zonaHoraria) : "-"} />
          <Dato etiqueta="Vencidas con saldo" valor={numberFormat.format(resumen.vencidasConSaldo)} tone={resumen.vencidasConSaldo > 0 ? "danger" : undefined} />
          <Dato etiqueta="Por vencer" valor={numberFormat.format(resumen.porVencer)} tone={resumen.porVencer > 0 ? "warn" : undefined} className="col-span-2 md:col-span-1" />
        </dl>
        {totales ? (
          <>
            <dl className="grid grid-cols-1 gap-px sm:grid-cols-2">
              <Dato etiqueta="Total comprado" valor={`$ ${formatearMonto(totales.totalComprado)}`} monto />
              <Dato etiqueta="Stock valorizado actual" valor={`$ ${formatearMonto(totales.stockValorizado)}`} monto />
            </dl>
            <p className="bg-(--surface) px-4 py-2.5 text-xs text-zinc-500">
              Ambos importes usan el costo unitario ACTUAL de cada partida: el sistema no guarda historial de costos (las correcciones quedan en la auditoría).
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
