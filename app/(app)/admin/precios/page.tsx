/**
 * `/admin/precios` (M08, FASE 4 point 4.6, DP-09 RESUELTA). Shows the
 * tenant's current margin and full version history, plus the form to save
 * a new version.
 */
import { getReglasPrecio } from "@/modules/precios/application/get-reglas-precio";
import { ReglaPrecioForm } from "@/modules/precios/ui/regla-precio-form";

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export default async function PreciosPage() {
  const { vigente, historial } = await getReglasPrecio();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Reglas de precio</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Precio de un ítem = costo de los insumos × margen (DP-09). Versionado: cada cambio de margen cierra la regla vigente y crea una nueva (INV-PR-001).
        </p>
      </div>

      <div className="mb-6">
        <ReglaPrecioForm margenActual={vigente ? vigente.margen : null} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-medium">Historial de versiones</h2>
        {historial.length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no se configuró ninguna regla de precio.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Margen (%)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Vigente desde</th>
                  <th scope="col" className="px-3 py-2 font-medium">Vigente hasta</th>
                  <th scope="col" className="px-3 py-2 font-medium">Creado por</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="px-3 py-2 font-medium">{r.margen}</td>
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
