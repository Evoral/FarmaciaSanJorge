/**
 * `/comparador-costos` (docs/specs/comparador-costos.md): pick ONE droga and
 * compare what each proveedor charged for it -- último costo, difference
 * against the cheapest, weighted average, range and partidas, as a
 * `table.data-table` whose rows expand to the proveedor's partidas
 * (`FilaDesplegable`). Access is the layout's `stock.valorizado.ver` guard.
 *
 * `searchParams` is untrusted and ONLY ever reads `droga` (uuid), `unidad`
 * (a unit code) and `periodo` (`12m` | `todo`), validated by
 * `parsearFiltrosComparador`; the use case re-checks the droga against the
 * tenant's own drogas with partidas. No receta / paciente data is involved.
 */
import { compararCostosDroga } from "@/modules/proveedores/application/comparar-costos-droga";
import { PERIODO_LABELS, parsearFiltrosComparador } from "@/modules/proveedores/domain/comparador-costos";
import { ComparadorEncabezado } from "@/modules/proveedores/ui/comparador-encabezado";
import { COLUMNAS_COMPARADOR, ComparadorCeldas, ComparadorDetalle, etiquetaProveedorComparador } from "@/modules/proveedores/ui/comparador-fila";
import { ComparadorFiltros } from "@/modules/proveedores/ui/comparador-filtros";
import { crearCatalogoUnidades } from "@/shared/format/cantidad";
import { FilaDesplegable } from "@/shared/ui/fila-desplegable";

interface ComparadorCostosPageProps {
  searchParams: Promise<{ droga?: string | string[]; unidad?: string | string[]; periodo?: string | string[] }>;
}

export default async function ComparadorCostosPage({ searchParams }: ComparadorCostosPageProps) {
  const query = await searchParams;
  const filtros = parsearFiltrosComparador(query);
  const { drogas, comparacion, drogaNoDisponible, linkPartida } = await compararCostosDroga({
    drogaId: filtros.drogaId ?? undefined,
    unidad: filtros.unidad ?? undefined,
    periodo: filtros.periodo,
  });

  const hayFiltros = Boolean(query.droga || query.unidad || query.periodo);
  const catalogo = comparacion ? crearCatalogoUnidades(comparacion.unidadesCatalogo) : null;
  const total = comparacion?.proveedores.length ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Comparador de costos</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Compare lo que cobró cada proveedor por una misma droga.</p>
      </div>

      <ComparadorFiltros
        drogas={drogas}
        drogaId={comparacion?.droga.id ?? null}
        periodo={filtros.periodo}
        unidadEnUrl={filtros.unidad}
        comparacion={comparacion}
        hayFiltros={hayFiltros}
      />

      {comparacion === null ? (
        <div className="card p-6 text-sm">
          {drogaNoDisponible || filtros.drogaInvalida ? (
            <p role="alert" className="mb-3 font-medium text-red-700 dark:text-red-300">
              La droga seleccionada no existe o todavía no tiene partidas registradas.
            </p>
          ) : null}
          {drogas.length === 0 ? (
            <p className="text-zinc-500">Todavía no hay partidas registradas, por lo que no hay costos para comparar.</p>
          ) : (
            <>
              <p className="mb-2 font-medium">Seleccione una droga para comparar a sus proveedores.</p>
              <ol className="list-decimal space-y-1 pl-5 text-zinc-600 dark:text-zinc-400">
                <li>Elija la droga en el filtro «Droga» (solo aparecen las que tienen partidas).</li>
                <li>Opcionalmente, cambie la unidad en «Mostrar costo por» y el período.</li>
                <li>Abra una fila para ver las partidas de ese proveedor.</li>
              </ol>
            </>
          )}
        </div>
      ) : (
        <div>
          <ComparadorEncabezado comparacion={comparacion} />

          <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
            {total} proveedor{total === 1 ? "" : "es"} con compras de esta droga ({PERIODO_LABELS[comparacion.periodo].toLowerCase()}).
          </p>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">Detalle</span>
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">Proveedor</th>
                  <th scope="col" className="px-3 py-2 font-medium">Último costo / {comparacion.unidadMostrada.simbolo}</th>
                  <th scope="col" className="px-3 py-2 font-medium">Última compra</th>
                  <th scope="col" className="px-3 py-2 font-medium">Diferencia vs. más barato</th>
                  <th scope="col" className="px-3 py-2 font-medium">Promedio ponderado</th>
                  <th scope="col" className="px-3 py-2 font-medium">Mín – Máx</th>
                  <th scope="col" className="px-3 py-2 font-medium">Partidas</th>
                </tr>
              </thead>
              <tbody>
                {total === 0 ? (
                  <tr>
                    <td colSpan={COLUMNAS_COMPARADOR} className="px-3 py-6 text-center text-zinc-500">
                      No hay compras de esta droga en el período seleccionado.
                      {comparacion.periodo === "12m" ? " Pruebe con «Todo el historial»." : ""}
                    </td>
                  </tr>
                ) : (
                  comparacion.proveedores.map((fila) => (
                    <FilaDesplegable
                      key={fila.proveedorId}
                      id={fila.proveedorId}
                      etiqueta={etiquetaProveedorComparador(fila)}
                      colSpan={COLUMNAS_COMPARADOR}
                      celdas={<ComparadorCeldas fila={fila} zonaHoraria={comparacion.zonaHoraria} />}
                      detalle={<ComparadorDetalle fila={fila} comparacion={comparacion} catalogo={catalogo!} linkPartida={linkPartida} />}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
