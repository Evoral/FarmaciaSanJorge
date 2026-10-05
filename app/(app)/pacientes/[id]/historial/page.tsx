/**
 * `/pacientes/[id]/historial` (docs/specs/trayectoria-paciente.md): read-only
 * view of everything a paciente went through, receta by receta (Ingreso ->
 * Preparación -> Libro -> Entrega -> Archivo). HEALTH-ADJACENT DATA (DP-24,
 * Ley 25.326): `[id]` is an opaque UUID and `searchParams` ONLY ever reads
 * `page` (a plain integer) -- nothing identifying goes in the URL. Access is
 * the parent layout's `pacientes.gestionar` guard; the optional blocks and
 * links are decided by the use case from the session's other permisos.
 * Recetas render as a `table.data-table` (same look as the other lists) whose
 * rows expand to the full journey (`FilaDesplegable`). The paciente's "Datos |
 * Trayectoria" tabs sit right under the header (`PacienteTabs`).
 */
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { getTrayectoriaPaciente } from "@/modules/pacientes/application/get-trayectoria-paciente";
import { PAGE_MAX_TRAYECTORIA } from "@/modules/pacientes/domain/trayectoria";
import { TrayectoriaEncabezado } from "@/modules/pacientes/ui/trayectoria-encabezado";
import { TrayectoriaRecetaCeldas, TrayectoriaRecetaDetalle, columnasTablaRecetas, etiquetaReceta } from "@/modules/pacientes/ui/trayectoria-receta-fila";
import { TrayectoriaResumen } from "@/modules/pacientes/ui/trayectoria-resumen";
import { uuid } from "@/shared/validation";
import { FilaDesplegable } from "@/shared/ui/fila-desplegable";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { PacienteTabs } from "../../pacientes-tabs";

interface TrayectoriaPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

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
  const pageHref = (target: number) => `/pacientes/${id}/historial?page=${target}`;

  return (
    <>
      <TrayectoriaEncabezado paciente={paciente} />
      <PacienteTabs id={id} />
      <TrayectoriaResumen resumen={resumen} zonaHoraria={zonaHoraria} />

      <section aria-labelledby="trayectoria-recetas" className="list-panel">
        <div className="list-toolbar">
          <h2 id="trayectoria-recetas" className="text-[0.9375rem] font-semibold text-zinc-900">
            Recetas
          </h2>
          <p role="status" className="text-xs">
            <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(paginacion.total)}</span> {paginacion.total === 1 ? "receta" : "recetas"}
            <span className="hidden sm:inline"> · tocá una fila para ver su recorrido</span>
          </p>
        </div>

        {recetas.length === 0 ? (
          <EmptyState icon={<FileText className="size-5" />} title="Sin recetas" description="Este paciente todavía no tiene recetas registradas." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="w-8 px-3 py-2">
                    <span className="sr-only">Detalle</span>
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Nº
                  </th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                    Ingreso
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Qué pide
                  </th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">
                    Médico
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Estado
                  </th>
                  <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                    Etapa
                  </th>
                  {acceso.presupuesto ? (
                    <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">
                      Presupuesto
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {recetas.map((receta) => (
                  <FilaDesplegable
                    key={receta.id}
                    id={receta.id}
                    etiqueta={etiquetaReceta(receta)}
                    colSpan={colSpan}
                    celdas={<TrayectoriaRecetaCeldas receta={receta} acceso={acceso} zonaHoraria={zonaHoraria} />}
                    detalle={<TrayectoriaRecetaDetalle receta={receta} acceso={acceso} zonaHoraria={zonaHoraria} />}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={paginacion.page} pageSize={paginacion.pageSize} total={paginacion.total} hrefFor={pageHref} label="Paginación de recetas del paciente" />
      </section>
    </>
  );
}
