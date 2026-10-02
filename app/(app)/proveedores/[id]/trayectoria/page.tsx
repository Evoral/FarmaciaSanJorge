/**
 * `/proveedores/[id]/trayectoria` (docs/specs/trayectoria-proveedor.md):
 * read-only view of everything a proveedor supplied, partida by partida, as a
 * `table.data-table` whose rows expand to the detail (`FilaDesplegable`).
 * `[id]` is an opaque UUID and `searchParams` ONLY ever reads `page` (a plain
 * integer) and `droga` (repeatable uuid filter, parsed by `parsearDrogaIds`
 * and re-checked against the proveedor's own drogas by the repository).
 * Access is the parent layout's
 * `proveedores.gestionar` guard; the optional blocks and links are decided by
 * the use case from the session's other permisos. No receta / paciente data.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTrayectoriaProveedor } from "@/modules/proveedores/application/get-trayectoria-proveedor";
import { PAGE_MAX_TRAYECTORIA_PROVEEDOR, parsearDrogaIds } from "@/modules/proveedores/domain/trayectoria";
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
    return `/proveedores/${id}/trayectoria?${params.toString()}`;
  };

  return (
    <div>
      <TrayectoriaEncabezado proveedor={proveedor} />
      <TrayectoriaResumen resumen={resumen} zonaHoraria={zonaHoraria} />

      <section aria-labelledby="trayectoria-partidas">
        <h2 id="trayectoria-partidas" className="mb-3 text-lg font-medium">
          Partidas
        </h2>

        {drogasDisponibles.length > 0 ? <TrayectoriaFiltroDrogas disponibles={drogasDisponibles} seleccionadas={drogaIds} /> : null}

        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
          {filtrando
            ? `${paginacion.total} de ${resumen.partidas} partidas.`
            : `${paginacion.total} partida${paginacion.total === 1 ? "" : "s"}.`}
        </p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Detalle</span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">Droga</th>
                <th scope="col" className="px-3 py-2 font-medium">Lote</th>
                <th scope="col" className="px-3 py-2 font-medium">Ingreso</th>
                <th scope="col" className="px-3 py-2 font-medium">Inicial → Disponible</th>
                <th scope="col" className="px-3 py-2 font-medium">Vence</th>
                <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                {acceso.costos ? (
                  <th scope="col" className="px-3 py-2 font-medium">Costo / unidad base</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {partidas.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-6 text-center text-zinc-500">
                    {filtrando ? "No hay partidas de las drogas seleccionadas." : "Este proveedor todavía no tiene partidas registradas."}
                  </td>
                </tr>
              ) : (
                partidas.map((partida) => (
                  <FilaDesplegable
                    key={partida.id}
                    id={partida.id}
                    etiqueta={etiquetaPartida(partida)}
                    colSpan={colSpan}
                    celdas={<TrayectoriaPartidaCeldas partida={partida} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />}
                    detalle={<TrayectoriaPartidaDetalle partida={partida} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {paginacion.totalPages > 1 ? (
          <nav aria-label="Paginación de partidas del proveedor" className="mt-4 flex items-center gap-2 text-sm">
            {paginacion.page <= 1 ? (
              <span aria-disabled="true" className="text-zinc-400">
                Anterior
              </span>
            ) : (
              <Link href={pageHref(paginacion.page - 1)} className="underline">
                Anterior
              </Link>
            )}
            <span>
              Página {paginacion.page} de {paginacion.totalPages}
            </span>
            {paginacion.page >= paginacion.totalPages ? (
              <span aria-disabled="true" className="text-zinc-400">
                Siguiente
              </span>
            ) : (
              <Link href={pageHref(paginacion.page + 1)} className="underline">
                Siguiente
              </Link>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
