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
import { CircleAlert, Scale, SearchX } from "lucide-react";
import { compararCostosDroga } from "@/modules/proveedores/application/comparar-costos-droga";
import { listSinonimosDrogasComparador } from "@/modules/proveedores/application/sinonimos-drogas";
import { PERIODO_LABELS, parsearFiltrosComparador } from "@/modules/proveedores/domain/comparador-costos";
import { ComparadorEncabezado } from "@/modules/proveedores/ui/comparador-encabezado";
import { COLUMNAS_COMPARADOR, ComparadorCeldas, ComparadorDetalle, etiquetaProveedorComparador } from "@/modules/proveedores/ui/comparador-fila";
import { ComparadorFiltros } from "@/modules/proveedores/ui/comparador-filtros";
import { crearCatalogoUnidades } from "@/shared/format/cantidad";
import { FilaDesplegable } from "@/shared/ui/fila-desplegable";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";

interface ComparadorCostosPageProps {
  searchParams: Promise<{ droga?: string | string[]; unidad?: string | string[]; periodo?: string | string[] }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function ComparadorCostosPage({ searchParams }: ComparadorCostosPageProps) {
  const query = await searchParams;
  const filtros = parsearFiltrosComparador(query);
  const [{ drogas, comparacion, drogaNoDisponible, linkPartida }, sinonimos] = await Promise.all([
    compararCostosDroga({
      drogaId: filtros.drogaId ?? undefined,
      unidad: filtros.unidad ?? undefined,
      periodo: filtros.periodo,
    }),
    listSinonimosDrogasComparador(),
  ]);

  const hayFiltros = Boolean(query.droga || query.unidad || query.periodo);
  const catalogo = comparacion ? crearCatalogoUnidades(comparacion.unidadesCatalogo) : null;
  const total = comparacion?.proveedores.length ?? 0;

  // The current (parsed) params, for the droga autocomplete to change just the droga.
  const actual = new URLSearchParams();
  if (comparacion) actual.set("droga", comparacion.droga.id);
  if (filtros.unidad) actual.set("unidad", filtros.unidad);
  if (filtros.periodo !== "12m") actual.set("periodo", filtros.periodo);
  const hrefActual = actual.size > 0 ? `/comparador-costos?${actual.toString()}` : "/comparador-costos";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Comparador de costos" }]}
        title="Comparador de costos"
        description="Elegí una droga y compará lo que cobró cada proveedor por ella."
      />

      <ComparadorFiltros
        drogas={drogas}
        drogaId={comparacion?.droga.id ?? null}
        periodo={filtros.periodo}
        unidadEnUrl={filtros.unidad}
        comparacion={comparacion}
        hayFiltros={hayFiltros}
        hrefActual={hrefActual}
        sinonimos={sinonimos}
      />

      {comparacion === null ? (
        <div className="flex flex-col gap-4">
          {drogaNoDisponible || filtros.drogaInvalida ? (
            <p role="alert" className="alert alert-danger">
              <CircleAlert aria-hidden />
              <span>La droga seleccionada no existe o todavía no tiene partidas registradas.</span>
            </p>
          ) : null}
          <div className="list-panel">
            {drogas.length === 0 ? (
              <EmptyState icon={<Scale className="size-5" />} title="Todavía no hay costos para comparar" description="Aparecen cuando se registran partidas con su costo." />
            ) : (
              <EmptyState
                icon={<Scale className="size-5" />}
                title="Elegí una droga para comparar a sus proveedores"
                description="Solo aparecen las drogas con partidas. Después podés cambiar la unidad del costo y el período, y abrir cada proveedor para ver sus partidas."
              />
            )}
          </div>
        </div>
      ) : (
        <div className="list-region">
          <span className="link-pending" aria-hidden />
          <ComparadorEncabezado comparacion={comparacion} />

          <div className="list-panel">
            <div className="list-toolbar">
              <p role="status">
                <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(total)}</span> {total === 1 ? "proveedor" : "proveedores"} con compras de esta
                droga <span className="text-zinc-500">({PERIODO_LABELS[comparacion.periodo].toLowerCase()})</span>
              </p>
            </div>

            {total === 0 ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin compras en el período"
                description={`No hay compras de esta droga en el período seleccionado.${comparacion.periodo === "12m" ? " Probá con «Todo el historial»." : ""}`}
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" className="w-8 px-3 py-2">
                        <span className="sr-only">Detalle</span>
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Proveedor
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Último costo / {comparacion.unidadMostrada.simbolo}
                      </th>
                      <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                        Última compra
                      </th>
                      <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">
                        Diferencia vs. más barato
                      </th>
                      <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">
                        Promedio ponderado
                      </th>
                      <th scope="col" className="hidden px-3 py-2 text-right xl:table-cell">
                        Mín - Máx
                      </th>
                      <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">
                        Partidas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparacion.proveedores.map((fila) => (
                      <FilaDesplegable
                        key={fila.proveedorId}
                        id={fila.proveedorId}
                        etiqueta={etiquetaProveedorComparador(fila)}
                        colSpan={COLUMNAS_COMPARADOR}
                        celdas={<ComparadorCeldas fila={fila} zonaHoraria={comparacion.zonaHoraria} />}
                        detalle={<ComparadorDetalle fila={fila} comparacion={comparacion} catalogo={catalogo!} linkPartida={linkPartida} />}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
