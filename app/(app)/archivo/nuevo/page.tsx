/**
 * `/archivo/nuevo` (FASE 12 point 12.1, user decision 4). Enter período +
 * ubicación (GET, only dates/ubicación ever travel through the URL) to
 * preview the eligible recetas, then confirm (POST) to conform the lote.
 *
 * Layout: the two steps are visible (1 período y ubicación, 2 confirmar); the preview fills the main column and the
 * confirmation sits beside it with what will be archived.
 */
import { redirect } from "next/navigation";
import { CircleAlert, FileSearch, Search } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRecetasElegiblesArchivo } from "@/modules/archivo/application/conformar-lote";
import { ConformarLoteForm } from "@/modules/archivo/ui/conformar-lote-form";
import { StatusBadge } from "@/shared/ui/status-badge";
import { DateInput } from "@/shared/ui/date-input";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Avatar } from "@/shared/ui/avatar";

interface ArchivoNuevoPageProps {
  searchParams: Promise<{ periodoDesde?: string; periodoHasta?: string; ubicacion?: string }>;
}

export default async function ArchivoNuevoPage({ searchParams }: ArchivoNuevoPageProps) {
  const session = await requireSession();
  if (!can(session, "archivo.lotes.gestionar")) redirect("/archivo");

  const params = await searchParams;
  const periodoDesde = params.periodoDesde ?? "";
  const periodoHasta = params.periodoHasta ?? "";
  const ubicacion = params.ubicacion ?? "";
  const periodoCompleto = periodoDesde.length > 0 && periodoHasta.length > 0 && periodoHasta >= periodoDesde;

  let elegibles: Awaited<ReturnType<typeof listRecetasElegiblesArchivo>> = [];
  let error: string | null = null;
  if (periodoCompleto) {
    try {
      elegibles = await listRecetasElegiblesArchivo({ periodoDesde, periodoHasta });
    } catch {
      error = "No se pudo calcular las recetas elegibles para ese período.";
    }
  }

  const listoParaConfirmar = periodoCompleto && !error;
  const conUbicacion = ubicacion.trim().length > 0;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Archivo", href: "/archivo" }, { label: "Conformar lote" }]}
        title="Conformar lote de archivo"
        description="Agrupá las recetas en papel de un período y registrá dónde se guardan."
      />

      <ol className="stepper" aria-label="Pasos para conformar el lote">
        <li data-state={listoParaConfirmar ? "done" : undefined} aria-current={listoParaConfirmar ? undefined : "step"}>
          <span className="stepper-dot" aria-hidden>
            1
          </span>
          Período y ubicación
        </li>
        <li aria-current={listoParaConfirmar ? "step" : undefined}>
          <span className="stepper-dot" aria-hidden>
            2
          </span>
          Revisar y confirmar
        </li>
      </ol>

      <section aria-label="Período y ubicación del lote" className="panel mb-6">
        <form method="get" className="flex flex-wrap items-end gap-4 p-5" aria-label="Período y ubicación del lote">
          <div className="field">
            <span id="nuevo-periodo-label" className="field-label">
              Período
            </span>
            <div className="range-field" role="group" aria-labelledby="nuevo-periodo-label">
              <label htmlFor="periodoDesde" className="sr-only">
                Período desde
              </label>
              <DateInput id="periodoDesde" name="periodoDesde" required defaultValue={periodoDesde} />
              <span className="range-field-sep" aria-hidden>
                a
              </span>
              <label htmlFor="periodoHasta" className="sr-only">
                Período hasta
              </label>
              <DateInput id="periodoHasta" name="periodoHasta" required defaultValue={periodoHasta} />
            </div>
          </div>
          <div className="field min-w-[14rem] flex-1">
            <label htmlFor="ubicacion" className="field-label">
              Ubicación
            </label>
            <input id="ubicacion" name="ubicacion" type="text" required defaultValue={ubicacion} placeholder="Ej.: Caja 12, estante B" className="input" />
          </div>
          <button type="submit" className="btn btn-secondary">
            <Search className="size-4" aria-hidden />
            Buscar elegibles
          </button>
        </form>
      </section>

      {!periodoCompleto ? (
        <div className="list-panel">
          <EmptyState icon={<FileSearch className="size-5" />} title="Elegí un período" description="Completá el período y la ubicación para ver las recetas que se pueden archivar." />
        </div>
      ) : error ? (
        <div role="alert" className="alert alert-danger">
          <CircleAlert aria-hidden />
          <p>{error}</p>
        </div>
      ) : (
        <div className="split-layout">
          <section aria-labelledby="elegibles-heading" className="list-panel min-w-0">
            <div className="list-toolbar">
              <h2 id="elegibles-heading" className="font-medium text-zinc-900" aria-live="polite">
                {elegibles.length} {elegibles.length === 1 ? "receta elegible" : "recetas elegibles"} del {formatFechaIso(periodoDesde)} al {formatFechaIso(periodoHasta)}
              </h2>
            </div>
            <p className="border-b border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
              Elegibles: entregadas o anuladas, sin lote asignado. Las recetas importadas desde PDF no se archivan (no tienen papel).
            </p>
            {elegibles.length === 0 ? (
              <EmptyState icon={<FileSearch className="size-5" />} title="No hay recetas elegibles en este período" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">
                        Nº
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Paciente
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Estado
                      </th>
                      <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                        Ingreso
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {elegibles.map((r) => {
                      const paciente = `${r.pacienteNombre} ${r.pacienteApellido}`;
                      return (
                        <tr key={r.id}>
                          <td className="px-3 py-2.5 font-mono font-semibold text-zinc-900">{r.numeroInterno}</td>
                          <td className="px-3 py-2.5">
                            <span className="flex items-center gap-2.5">
                              <Avatar name={paciente} />
                              <span className="truncate text-zinc-900">{paciente}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusBadge estado={r.estado} />
                          </td>
                          <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums sm:table-cell">{formatFechaIso(r.fechaIngreso)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="split-aside" aria-label="Confirmar el lote">
            <section className="panel" aria-labelledby="confirmar-heading">
              <div className="panel-header">
                <h2 id="confirmar-heading">Confirmar lote</h2>
              </div>
              <div className="panel-body flex flex-col gap-4">
                <dl className="summary-dl">
                  <dt>Período</dt>
                  <dd className="tabular-nums">
                    {formatFechaIso(periodoDesde)} a {formatFechaIso(periodoHasta)}
                  </dd>
                  <dt>Ubicación</dt>
                  <dd data-empty={!conUbicacion || undefined}>{conUbicacion ? ubicacion : "Sin ubicación"}</dd>
                  <dt>Recetas</dt>
                  <dd className="font-mono tabular-nums">{elegibles.length}</dd>
                </dl>
                {conUbicacion ? (
                  <ConformarLoteForm periodoDesde={periodoDesde} periodoHasta={periodoHasta} ubicacion={ubicacion} cantidadElegibles={elegibles.length} />
                ) : (
                  <p className="text-[0.8125rem] text-zinc-600">Ingresá una ubicación arriba para poder confirmar.</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
