/**
 * `/proveedores/[id]/historial` (docs/specs/trayectoria-proveedor.md):
 * read-only view of everything a proveedor supplied, partida by partida, as a
 * `table.data-table` whose rows expand to the detail (`FilaDesplegable`).
 * `[id]` is an opaque UUID and `searchParams` ONLY ever reads `page` (a plain
 * integer) and `droga` (repeatable uuid filter, parsed by `parsearDrogaIds`
 * and re-checked against the proveedor's own drogas by the repository).
 * Access is the parent layout's
 * `proveedores.gestionar` guard; the optional blocks and links are decided by
 * the use case from the session's other permisos. No receta / paciente data.
 * The proveedor's "Datos | Historial" tabs sit right under the header
 * (`ProveedorTabs`); the droga filter is an autocomplete in the table toolbar.
 */
import { notFound } from "next/navigation";
import { PackageSearch, SearchX } from "lucide-react";
import { getTrayectoriaProveedor } from "@/modules/proveedores/application/get-trayectoria-proveedor";
import { PAGE_MAX_TRAYECTORIA_PROVEEDOR, drogasRestantes, drogasSeleccionadas, parsearDrogaIds } from "@/modules/proveedores/domain/trayectoria";
import { TrayectoriaEncabezado } from "@/modules/proveedores/ui/trayectoria-encabezado";
import { TrayectoriaFiltroDrogas } from "@/modules/proveedores/ui/trayectoria-filtro-drogas";
import { TrayectoriaPartidaCeldas, TrayectoriaPartidaDetalle, columnasTablaPartidas, etiquetaPartida } from "@/modules/proveedores/ui/trayectoria-partida-fila";
import { TrayectoriaResumen } from "@/modules/proveedores/ui/trayectoria-resumen";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { can } from "@/shared/auth/authorize";
import { requireSession } from "@/shared/auth/session";
import { crearCatalogoUnidades } from "@/shared/format/cantidad";
import { FilaDesplegable } from "@/shared/ui/fila-desplegable";
import { uuid } from "@/shared/validation";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ProveedorTabs } from "../../proveedor-tabs";

const numberFormat = new Intl.NumberFormat("es-AR");

interface TrayectoriaPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; droga?: string | string[] }>;
}

export default async function TrayectoriaProveedorPage({ params, searchParams }: TrayectoriaPageProps) {
  const session = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  // Same rule as the use case's own input (zod uuid): anything else is a 404, never a ValidationError.
  if (!uuid.safeParse(id).success) notFound();

  // Clamped into the use case's accepted range (a huge digit string parses to Infinity); the repository then clamps to the last page.
  const parsedPage = Number.parseInt(query.page ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) ? Math.min(PAGE_MAX_TRAYECTORIA_PROVEEDOR, Math.max(1, parsedPage)) : 1;
  // Valid uuids only, deduplicated, capped: the repository then keeps just the ones that are this proveedor's drogas.
  const trayectoria = await getTrayectoriaProveedor({ proveedorId: id, page: requestedPage, drogaIds: parsearDrogaIds(query.droga) });
  if (!trayectoria) notFound();

  // The unit catalog is gated on `stock.ver`: without it (a denial would write an ACCESO_DENEGADO audit row) quantities show in the droga's own unidad base, unconverted.
  const catalogo = can(session, "stock.ver") ? (await getCatalogoUnidades()).catalogo : crearCatalogoUnidades([]);

  const { proveedor, acceso, resumen, partidas, paginacion, zonaHoraria, drogasDisponibles, drogaIds } = trayectoria;
  const colSpan = columnasTablaPartidas(acceso);
  const filtrando = drogaIds.length > 0;
  // Pagination links keep EVERY selected droga (the effective filter, not the raw URL).
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    for (const droga of drogaIds) params.append("droga", droga);
    params.set("page", String(target));
    return `/proveedores/${id}/historial?${params.toString()}`;
  };

  const baseHref = `/proveedores/${id}/historial`;

  return (
    <>
      <TrayectoriaEncabezado proveedor={proveedor} />
      <ProveedorTabs id={id} />
      <TrayectoriaResumen resumen={resumen} zonaHoraria={zonaHoraria} />

      <section aria-labelledby="trayectoria-partidas" className="list-panel">
        <div className="list-toolbar flex-wrap gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="trayectoria-partidas" className="text-[0.9375rem] font-semibold text-zinc-900">
              Partidas
            </h2>
            <p role="status" className="text-xs">
              {filtrando ? (
                <>
                  <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(paginacion.total)}</span> de{" "}
                  <span className="tabular-nums">{numberFormat.format(resumen.partidas)}</span> partidas
                </>
              ) : (
                <>
                  <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(paginacion.total)}</span> {paginacion.total === 1 ? "partida" : "partidas"}
                </>
              )}
              <span className="hidden sm:inline"> · tocá una fila para ver su detalle</span>
            </p>
          </div>
          {drogasDisponibles.length > 0 ? (
            <TrayectoriaFiltroDrogas
              elegidas={drogasSeleccionadas(drogasDisponibles, drogaIds)}
              restantes={drogasRestantes(drogasDisponibles, drogaIds)}
              baseHref={baseHref}
            />
          ) : null}
        </div>

        {partidas.length === 0 ? (
          filtrando ? (
            <EmptyState icon={<SearchX className="size-5" />} title="Sin resultados" description="No hay partidas de las drogas seleccionadas." />
          ) : (
            <EmptyState icon={<PackageSearch className="size-5" />} title="Sin partidas" description="Este proveedor todavía no tiene partidas registradas." />
          )
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="w-8 px-3 py-2">
                    <span className="sr-only">Detalle</span>
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Droga
                  </th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                    Lote
                  </th>
                  <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                    Ingreso
                  </th>
                  <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">
                    Inicial → Disponible
                  </th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                    Vence
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Estado
                  </th>
                  {acceso.costos ? (
                    <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">
                      Costo / unidad base
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {partidas.map((partida) => (
                  <FilaDesplegable
                    key={partida.id}
                    id={partida.id}
                    etiqueta={etiquetaPartida(partida)}
                    colSpan={colSpan}
                    celdas={<TrayectoriaPartidaCeldas partida={partida} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />}
                    detalle={<TrayectoriaPartidaDetalle partida={partida} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={paginacion.page} pageSize={paginacion.pageSize} total={paginacion.total} hrefFor={pageHref} label="Paginación de partidas del proveedor" />
      </section>
    </>
  );
}
