/**
 * `/proveedores/[id]/trayectoria` (docs/specs/trayectoria-proveedor.md):
 * read-only view of everything a proveedor supplied, partida by partida, as an
 * expandable list. `[id]` is an opaque UUID and `searchParams` ONLY ever reads
 * `page` (a plain integer). Access is the parent layout's
 * `proveedores.gestionar` guard; the optional blocks and links are decided by
 * the use case from the session's other permisos. No receta / paciente data.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTrayectoriaProveedor } from "@/modules/proveedores/application/get-trayectoria-proveedor";
import { PAGE_MAX_TRAYECTORIA_PROVEEDOR } from "@/modules/proveedores/domain/trayectoria";
import { TrayectoriaEncabezado } from "@/modules/proveedores/ui/trayectoria-encabezado";
import { TrayectoriaPartidaCard } from "@/modules/proveedores/ui/trayectoria-partida-card";
import { TrayectoriaResumen } from "@/modules/proveedores/ui/trayectoria-resumen";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { can } from "@/shared/auth/authorize";
import { requireSession } from "@/shared/auth/session";
import { crearCatalogoUnidades } from "@/shared/format/cantidad";
import { uuid } from "@/shared/validation";

interface TrayectoriaPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
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
  const trayectoria = await getTrayectoriaProveedor({ proveedorId: id, page: requestedPage });
  if (!trayectoria) notFound();

  // The unit catalog is gated on `stock.ver`: without it (a denial would write an ACCESO_DENEGADO audit row) quantities show in the droga's own unidad base, unconverted.
  const catalogo = can(session, "stock.ver") ? (await getCatalogoUnidades()).catalogo : crearCatalogoUnidades([]);

  const { proveedor, acceso, resumen, partidas, paginacion, zonaHoraria } = trayectoria;
  const pageHref = (target: number) => `/proveedores/${id}/trayectoria?page=${target}`;

  return (
    <div>
      <TrayectoriaEncabezado proveedor={proveedor} />
      <TrayectoriaResumen resumen={resumen} zonaHoraria={zonaHoraria} />

      <section aria-labelledby="trayectoria-partidas">
        <h2 id="trayectoria-partidas" className="mb-3 text-lg font-medium">
          Partidas
        </h2>

        {partidas.length === 0 ? (
          <div className="card p-6 text-center text-sm text-zinc-500">Este proveedor todavía no tiene partidas registradas.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {partidas.map((partida) => (
              <TrayectoriaPartidaCard key={partida.id} partida={partida} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />
            ))}
          </div>
        )}

        {paginacion.totalPages > 1 ? (
          <nav aria-label="Paginación de partidas del proveedor" className="mt-4 flex items-center gap-2 text-sm">
            <Link
              href={pageHref(Math.max(1, paginacion.page - 1))}
              aria-disabled={paginacion.page <= 1}
              className={paginacion.page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}
            >
              Anterior
            </Link>
            <span>
              Página {paginacion.page} de {paginacion.totalPages}
            </span>
            <Link
              href={pageHref(Math.min(paginacion.totalPages, paginacion.page + 1))}
              aria-disabled={paginacion.page >= paginacion.totalPages}
              className={paginacion.page >= paginacion.totalPages ? "pointer-events-none text-zinc-400" : "underline"}
            >
              Siguiente
            </Link>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
