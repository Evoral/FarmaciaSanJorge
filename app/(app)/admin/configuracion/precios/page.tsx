/**
 * `/admin/configuracion/precios` (M08, FASE 4 point 4.6). Shows the
 * tenant's current price rule set (precio mínimo + margin tramos by cost,
 * docs/specs/reglas-precio.md) and its full version history, plus the form
 * to save a new version.
 */
import { getReglasPrecio } from "@/modules/precios/application/get-reglas-precio";
import type { TramoGuardado } from "@/modules/precios/application/get-reglas-precio";
import { ReglaPrecioForm } from "@/modules/precios/ui/regla-precio-form";
import { formatNumero } from "@/shared/format/cantidad";

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

function pesos(valor: string): string {
  return `$${formatNumero(valor, 2)}`;
}

/** "Hasta $100.000: +100%" / "Más de $100.000: +70%" -- one line per tramo. */
function TramosLista({ tramos }: { tramos: TramoGuardado[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {tramos.map((t, i) => {
        const anterior = i > 0 ? tramos[i - 1]!.costoHasta : null;
        const rango = t.costoHasta !== null ? `Hasta ${pesos(t.costoHasta)}` : anterior !== null ? `Más de ${pesos(anterior)}` : "Cualquier costo";
        return (
          <li key={i}>
            {rango}: +{formatNumero(t.margen, 2)}%
          </li>
        );
      })}
    </ul>
  );
}

export default async function PreciosPage() {
  const { vigente, historial } = await getReglasPrecio();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Reglas de precio</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Precio de cada preparación = el mayor entre (costo de insumos + margen del tramo de ese costo) y el precio mínimo. Versionado: cada cambio cierra la regla vigente y crea
          una nueva.
        </p>
      </div>

      <div className="mb-6">
        <ReglaPrecioForm key={vigente?.id ?? "sin-regla"} vigente={vigente ? { precioMinimo: vigente.precioMinimo, tramos: vigente.tramos } : null} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-medium">Historial de versiones</h2>
        {historial.length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no se configuró ninguna regla de precio.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Tramos de margen</th>
                  <th scope="col" className="px-3 py-2 font-medium">Precio mínimo</th>
                  <th scope="col" className="px-3 py-2 font-medium">Vigente desde</th>
                  <th scope="col" className="px-3 py-2 font-medium">Vigente hasta</th>
                  <th scope="col" className="px-3 py-2 font-medium">Creado por</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2">
                      <TramosLista tramos={r.tramos} />
                    </td>
                    <td className="px-3 py-2">{pesos(r.precioMinimo)}</td>
                    <td className="px-3 py-2">{fechaHora(r.vigenteDesde)}</td>
                    <td className="px-3 py-2">{r.vigenteHasta ? fechaHora(r.vigenteHasta) : <span className="text-emerald-600 dark:text-emerald-400">Vigente</span>}</td>
                    <td className="px-3 py-2">{r.creadoPorApellido}, {r.creadoPorNombre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
