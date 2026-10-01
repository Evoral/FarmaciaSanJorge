/**
 * `/pacientes/[id]/trayectoria` (docs/specs/trayectoria-paciente.md): read-only
 * view of everything a paciente went through, receta by receta (Ingreso ->
 * Preparación -> Libro -> Entrega -> Archivo). HEALTH-ADJACENT DATA (DP-24,
 * Ley 25.326): `[id]` is an opaque UUID and `searchParams` ONLY ever reads
 * `page` (a plain integer) -- nothing identifying goes in the URL. Access is
 * the parent layout's `pacientes.gestionar` guard; the optional blocks and
 * links are decided by the use case from the session's other permisos.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTrayectoriaPaciente } from "@/modules/pacientes/application/get-trayectoria-paciente";
import { PAGE_MAX_TRAYECTORIA } from "@/modules/pacientes/domain/trayectoria";
import { TrayectoriaEncabezado } from "@/modules/pacientes/ui/trayectoria-encabezado";
import { TrayectoriaRecetaCard } from "@/modules/pacientes/ui/trayectoria-receta-card";
import { TrayectoriaResumen } from "@/modules/pacientes/ui/trayectoria-resumen";
import { uuid } from "@/shared/validation";

interface TrayectoriaPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function TrayectoriaPacientePage({ params, searchParams }: TrayectoriaPageProps) {
  const { id } = await params;
  const query = await searchParams;
  // Same rule as the use case's own input (zod uuid): anything else is a 404, never a ValidationError.
  if (!uuid.safeParse(id).success) notFound();

  // Clamped into the use case's accepted range (a huge digit string parses to Infinity); the repository then clamps to the last page.
  const parsedPage = Number.parseInt(query.page ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) ? Math.min(PAGE_MAX_TRAYECTORIA, Math.max(1, parsedPage)) : 1;
  const trayectoria = await getTrayectoriaPaciente({ pacienteId: id, page: requestedPage });
  if (!trayectoria) notFound();

  const { paciente, acceso, resumen, recetas, paginacion, zonaHoraria } = trayectoria;
  const pageHref = (target: number) => `/pacientes/${id}/trayectoria?page=${target}`;

  return (
    <div>
      <TrayectoriaEncabezado paciente={paciente} />
      <TrayectoriaResumen resumen={resumen} zonaHoraria={zonaHoraria} />

      <section aria-labelledby="trayectoria-recetas">
        <h2 id="trayectoria-recetas" className="mb-3 text-lg font-medium">
          Recetas
        </h2>

        {recetas.length === 0 ? (
          <div className="card p-6 text-center text-sm text-zinc-500">Este paciente todavía no tiene recetas registradas.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {recetas.map((receta) => (
              <TrayectoriaRecetaCard key={receta.id} receta={receta} acceso={acceso} zonaHoraria={zonaHoraria} />
            ))}
          </div>
        )}

        {paginacion.totalPages > 1 ? (
          <nav aria-label="Paginación de recetas del paciente" className="mt-4 flex items-center gap-2 text-sm">
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
