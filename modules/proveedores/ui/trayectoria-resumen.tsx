/**
 * "Resumen" cards of the proveedor Trayectoria: counters over ALL the
 * proveedor's partidas (not just the visible page). The money cards exist only
 * when `resumen.totales` is present (the session holds `stock.valorizado.ver`).
 * Quantities are never summed across drogas (different unidad base), so there
 * is no "total stock" card. Server component.
 */
import { formatFecha } from "@/shared/format/fecha";
import { formatearMonto } from "@/shared/format/monto";
import type { ResumenTrayectoriaProveedor } from "../domain/trayectoria";

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | number }) {
  return (
    <div className="card p-4">
      <dt className="text-xs text-zinc-500">{etiqueta}</dt>
      <dd className="mt-1 text-2xl font-semibold">{valor}</dd>
    </div>
  );
}

export function TrayectoriaResumen({ resumen, zonaHoraria }: { resumen: ResumenTrayectoriaProveedor; zonaHoraria: string }) {
  const { totales } = resumen;
  return (
    <section aria-labelledby="trayectoria-resumen" className="mb-8">
      <h2 id="trayectoria-resumen" className="mb-3 text-lg font-medium">
        Resumen
      </h2>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Dato etiqueta="Partidas" valor={resumen.partidas} />
        <Dato etiqueta="Drogas distintas" valor={resumen.drogasDistintas} />
        <Dato etiqueta="Último ingreso" valor={resumen.ultimoIngreso ? formatFecha(resumen.ultimoIngreso, zonaHoraria) : "—"} />
        <Dato etiqueta="Vencidas con saldo" valor={resumen.vencidasConSaldo} />
        <Dato etiqueta="Por vencer" valor={resumen.porVencer} />
        {totales ? <Dato etiqueta="Total comprado" valor={`$ ${formatearMonto(totales.totalComprado)}`} /> : null}
        {totales ? <Dato etiqueta="Stock valorizado actual" valor={`$ ${formatearMonto(totales.stockValorizado)}`} /> : null}
      </dl>
      {totales ? (
        <p className="mt-2 text-xs text-zinc-500">
          Ambos importes usan el costo unitario ACTUAL de cada partida: el sistema no guarda historial de costos (las correcciones quedan en la auditoría).
        </p>
      ) : null}
    </section>
  );
}
