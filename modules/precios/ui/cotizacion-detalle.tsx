/** Read-only breakdown of one cotización (FASE 7 point 7.4): línea, droga, cantidad, partida, costo unitario, subtotal, margen, precio final, flags parcial/incompleta. Server Component (no interactivity). */
import type { CotizacionItemOutput } from "@/modules/precios/application/get-cotizacion-item";

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function CotizacionDetalleView({ cotizacion }: { cotizacion: CotizacionItemOutput }) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">
          Calculada el {fechaHora(cotizacion.calculadaEn)} por {cotizacion.calculadaPorApellido}, {cotizacion.calculadaPorNombre}
        </p>
        <div className="flex gap-2">
          {cotizacion.esParcial ? (
            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              Parcial: hay líneas de enrase manual sin costo
            </span>
          ) : null}
          {cotizacion.esIncompleta ? (
            <span className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
              Incompleta: stock insuficiente en alguna línea
            </span>
          ) : null}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="text-zinc-500">Costo insumos</dt>
          <dd className="text-base font-semibold">${cotizacion.costoInsumos}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Margen aplicado</dt>
          <dd className="text-base font-semibold">{cotizacion.margenAplicado}%</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Precio final</dt>
          <dd className="text-base font-semibold">${cotizacion.precioFinal}</dd>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Droga</th>
              <th scope="col" className="py-1 pr-3 font-medium">Cantidad</th>
              <th scope="col" className="py-1 pr-3 font-medium">Partidas usadas</th>
              <th scope="col" className="py-1 pr-3 font-medium">Subtotal</th>
              <th scope="col" className="py-1 font-medium">Faltante</th>
            </tr>
          </thead>
          <tbody>
            {cotizacion.detalle.lineas.map((linea) => (
              <tr key={linea.orden} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900 align-top">
                <td className="py-1 pr-3">{linea.drogaNombre}</td>
                <td className="py-1 pr-3">
                  {linea.esEnraseManual ? <span className="text-zinc-500">Enrase manual (sin costo)</span> : `${linea.cantidadRequerida} ${linea.unidadSimbolo}`}
                </td>
                <td className="py-1 pr-3">
                  {linea.partidas.length === 0 ? (
                    <span className="text-zinc-500">—</span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {linea.partidas.map((p) => (
                        <li key={p.partidaId}>
                          {p.cantidad} × ${p.costoUnitario} = ${p.subtotal}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-1 pr-3">${linea.subtotal}</td>
                <td className="py-1">{linea.faltante ? <span className="text-red-600 dark:text-red-400">{linea.faltante} {linea.unidadSimbolo}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
