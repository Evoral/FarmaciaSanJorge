/**
 * `/pacientes/[id]/trayectoria` (docs/specs/trayectoria-paciente.md): read-only
 * view of everything a paciente went through, receta by receta (Ingreso ->
 * Preparación -> Libro -> Entrega -> Archivo). HEALTH-ADJACENT DATA (DP-24,
 * Ley 25.326): `[id]` is an opaque UUID and `searchParams` ONLY ever reads
 * `page` (a plain integer) -- nothing identifying goes in the URL. Access is
 * the parent layout's `pacientes.gestionar` guard; the optional blocks and
 * links are decided by the use case from the session's other permisos.
 * Recetas render as a `table.data-table` (same look as the other lists) whose
 * rows expand to the full journey (`FilaDesplegable`).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTrayectoriaPaciente } from "@/modules/pacientes/application/get-trayectoria-paciente";
import { PAGE_MAX_TRAYECTORIA } from "@/modules/pacientes/domain/trayectoria";
import { TrayectoriaEncabezado } from "@/modules/pacientes/ui/trayectoria-encabezado";
import { TrayectoriaRecetaCeldas, TrayectoriaRecetaDetalle, columnasTablaRecetas, etiquetaReceta } from "@/modules/pacientes/ui/trayectoria-receta-fila";
import { TrayectoriaResumen } from "@/modules/pacientes/ui/trayectoria-resumen";
import { uuid } from "@/shared/validation";
import { FilaDesplegable } from "@/shared/ui/fila-desplegable";

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
  const colSpan = columnasTablaRecetas(acceso);
  const pageHref = (target: number) => `/pacientes/${id}/trayectoria?page=${target}`;

  return (
    <div>
      <TrayectoriaEncabezado paciente={paciente} />
      <TrayectoriaResumen resumen={resumen} zonaHoraria={zonaHoraria} />

      <section aria-labelledby="trayectoria-recetas">
        <h2 id="trayectoria-recetas" className="mb-3 text-lg font-medium">
          Recetas
        </h2>

        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
          {paginacion.total} receta{paginacion.total === 1 ? "" : "s"}.
        </p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Detalle</span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">Receta Nº</th>
                <th scope="col" className="px-3 py-2 font-medium">Ingreso</th>
                <th scope="col" className="px-3 py-2 font-medium">Qué pide</th>
                <th scope="col" className="px-3 py-2 font-medium">Médico</th>
                <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                <th scope="col" className="px-3 py-2 font-medium">Etapa</th>
                {acceso.presupuesto ? (
                  <th scope="col" className="px-3 py-2 font-medium">Presupuesto</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {recetas.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-6 text-center text-zinc-500">
                    Este paciente todavía no tiene recetas registradas.
                  </td>
                </tr>
              ) : (
                recetas.map((receta) => (
                  <FilaDesplegable
                    key={receta.id}
                    id={receta.id}
                    etiqueta={etiquetaReceta(receta)}
                    colSpan={colSpan}
                    celdas={<TrayectoriaRecetaCeldas receta={receta} acceso={acceso} zonaHoraria={zonaHoraria} />}
                    detalle={<TrayectoriaRecetaDetalle receta={receta} acceso={acceso} zonaHoraria={zonaHoraria} />}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {paginacion.totalPages > 1 ? (
          <nav aria-label="Paginación de recetas del paciente" className="mt-4 flex items-center gap-2 text-sm">
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
