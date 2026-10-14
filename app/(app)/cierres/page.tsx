/**
 * `/cierres` (FASE 10, M13a point 10.1). Jornadas pendientes de firma
 * (oldest first, only the oldest can be signed -- chronological order,
 * INV-C19 is the real backstop) plus, for that oldest jornada, the paginated
 * recetario asientos registered on it: what the DT reviews before signing.
 * The signed history lives in its own tab (`./historial/page.tsx`).
 *
 * Layout: the pending jornadas and the asientos to review in the main
 * column, the firma form beside them.
 *
 * The "Pendientes de firma" tab and index route of the sidebar's "Gestión
 * DT" section (`../nav-sections.ts#gestionDtSections`). Its own guard
 * lives here, not in a nested layout (that would also cover the sibling
 * tabs). Every tab of the section requires `cierres.ver`, so without it
 * the session goes back to `/` (a `cierres.reporte`-only session gets here
 * through `./layout.tsx` for `/cierres/reporte`).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ChevronRight, CircleCheck, FileBarChart } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listJornadasPendientes } from "@/modules/cierres/application/list-jornadas-pendientes";
import { listAsientosJornada } from "@/modules/cierres/application/list-asientos-jornada";
import { FirmarForm } from "@/modules/cierres/ui/firmar-form";
import { etiquetaEstadoVisual } from "@/modules/libro/domain/estado-visual";
import { tonoEstadoAsiento } from "@/modules/libro/ui/libro-nav";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";
import { SectionTabs } from "../section-tabs";
import { gestionDtSections } from "../nav-sections";

const PAGE_SIZE = 25;

interface CierresPageProps {
  searchParams: Promise<{ page?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function CierresPage({ searchParams }: CierresPageProps) {
  const session = await requireSession();
  const secciones = gestionDtSections(session);
  if (!can(session, "cierres.ver")) {
    redirect("/");
  }
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const puedeFirmar = can(session, "cierres.firmar");
  const puedeVerReporte = can(session, "cierres.reporte");
  const puedeVerLibro = can(session, "libro.ver");

  const pendientes = await listJornadasPendientes();
  const laMasAntigua = pendientes.find((p) => p.esLaMasAntigua) ?? null;
  const asientos = laMasAntigua ? await listAsientosJornada({ fecha: laMasAntigua.fecha, page, pageSize: PAGE_SIZE }) : null;

  function pageHref(targetPage: number): string {
    return `/cierres?page=${targetPage}`;
  }

  const fueraDeTermino = pendientes.filter((p) => p.fueraDeTermino).length;
  const mostrarFirma = puedeFirmar && laMasAntigua !== null;

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Gestión DT" }, { label: "Pendientes de firma" }]}
        title="Pendientes de firma"
        description="Firma de cada jornada por el Director Técnico, en orden cronológico. Revisá las recetas de la jornada antes de firmarla."
        actions={
          puedeVerReporte ? (
            <Link href="/cierres/reporte" className="btn btn-secondary">
              <FileBarChart className="size-4" aria-hidden />
              Reporte de cumplimiento
            </Link>
          ) : null
        }
      />

      <SectionTabs ariaLabel="Secciones de gestión DT" links={secciones} />

      {pendientes.length === 0 || !laMasAntigua || !asientos ? (
        <div className="list-panel">
          <EmptyState icon={<CircleCheck className="size-5" />} title="Todo firmado" description="No hay jornadas anteriores pendientes de firma. La jornada de hoy se firma mañana." />
        </div>
      ) : (
        <div className={mostrarFirma ? "split-layout" : undefined}>
          <div className="flex min-w-0 flex-col gap-8">
            <section aria-labelledby="pendientes-heading">
              <div className="section-heading">
                <h2 id="pendientes-heading" className="flex items-center gap-2">
                  Jornadas pendientes <span className="tab-count">{pendientes.length}</span>
                </h2>
                {fueraDeTermino > 0 ? <span className="text-xs font-medium text-red-700">{fueraDeTermino} fuera de término</span> : null}
              </div>

              <div className="list-panel">
                <ul aria-label="Jornadas pendientes, de la más antigua a la más reciente">
                  {pendientes.map((p) => (
                    <li key={p.fecha} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-100 px-4 py-3 last:border-b-0" data-proxima={p.esLaMasAntigua || undefined}>
                      <div className="min-w-[9rem]">
                        <p className="font-mono text-sm font-semibold text-zinc-900 tabular-nums">{formatFechaIso(p.fecha)}</p>
                        <p className="text-xs text-zinc-500">
                          {p.antiguedadDias === 0 ? "Hoy" : `Hace ${p.antiguedadDias} ${p.antiguedadDias === 1 ? "día" : "días"}`}
                        </p>
                      </div>
                      <dl className="flex flex-1 flex-wrap gap-x-6 gap-y-1 text-xs">
                        <div>
                          <dt className="text-zinc-500">Recetario</dt>
                          <dd className="font-mono text-sm text-zinc-900 tabular-nums">{p.cantidadRecetario}</dd>
                        </div>
                        <div>
                          <dt className="text-zinc-500">Contralor</dt>
                          <dd className="font-mono text-sm text-zinc-900 tabular-nums">{p.cantidadContralor}</dd>
                        </div>
                      </dl>
                      <div className="flex flex-wrap items-center gap-2">
                        {p.esLaMasAntigua ? <ToneBadge tone="neutral">Siguiente a firmar</ToneBadge> : null}
                        <ToneBadge tone={p.fueraDeTermino ? "danger" : "success"}>{p.fueraDeTermino ? "Fuera de término" : "En término"}</ToneBadge>
                      </div>
                    </li>
                  ))}
                </ul>
                {pendientes.length > 1 ? <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">Las jornadas se firman en orden: primero la más antigua.</p> : null}
              </div>
            </section>

            <section aria-labelledby="recetas-jornada-heading" id="recetas-jornada">
              <div className="section-heading">
                <h2 id="recetas-jornada-heading">
                  Recetas de la jornada <span className="font-mono tabular-nums">{formatFechaIso(laMasAntigua.fecha)}</span>
                </h2>
              </div>

              <div className="list-region">
                <span className="link-pending" aria-hidden />
                <div className="list-panel">
                  <div className="list-toolbar">
                    <p role="status">
                      <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(asientos.total)}</span> {asientos.total === 1 ? "receta registrada" : "recetas registradas"} en el libro
                    </p>
                  </div>

                  {asientos.items.length === 0 ? (
                    <EmptyState
                      icon={<BookOpen className="size-5" />}
                      title={asientos.total === 0 ? "Sin recetas en el libro" : "Página vacía"}
                      description={asientos.total === 0 ? "Esta jornada no tiene asientos en el libro recetario." : undefined}
                    />
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
                            <th scope="col" className="hidden px-3 py-2 md:table-cell">
                              Médico
                            </th>
                            <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                              Fórmula
                            </th>
                            <th scope="col" className="px-3 py-2">
                              Estado
                            </th>
                            {puedeVerLibro ? (
                              <th scope="col" className="px-3 py-2">
                                <span className="sr-only">Acciones</span>
                              </th>
                            ) : null}
                          </tr>
                        </thead>
                        <tbody>
                          {asientos.items.map((item) => (
                            <tr key={item.id}>
                              <td className="px-3 py-2.5">
                                {puedeVerLibro ? (
                                  <Link href={`/libro/${item.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                                    {item.numeroCorrelativo}
                                  </Link>
                                ) : (
                                  <span className="font-mono font-semibold">{item.numeroCorrelativo}</span>
                                )}
                                {item.esRectificativo ? <span className="block text-xs text-zinc-500">Rectifica Nº {item.asientoOriginalNumeroCorrelativo}</span> : null}
                              </td>
                              <td className="px-3 py-2.5 text-zinc-900">
                                <span className="block max-w-[16rem] break-words">{item.pacienteTexto}</span>
                                <span className="block max-w-[16rem] break-words text-xs text-zinc-500 md:hidden">{item.medicoTexto}</span>
                              </td>
                              <td className="hidden px-3 py-2.5 md:table-cell">
                                <span className="block max-w-[16rem] break-words">{item.medicoTexto}</span>
                              </td>
                              <td className="hidden px-3 py-2.5 lg:table-cell">
                                <span className="block max-w-xs truncate" title={item.formulaTexto}>
                                  {item.formulaTexto}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <ToneBadge tone={tonoEstadoAsiento(item.estadoVisual.kind)}>{etiquetaEstadoVisual(item.estadoVisual)}</ToneBadge>
                              </td>
                              {puedeVerLibro ? (
                                <td className="px-3 py-2.5 text-right">
                                  <Link href={`/libro/${item.id}`} aria-label={`Ver el asiento Nº ${item.numeroCorrelativo}`} className="btn btn-ghost btn-sm btn-icon">
                                    <ChevronRight className="size-4" aria-hidden />
                                  </Link>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <Pagination page={page} pageSize={PAGE_SIZE} total={asientos.total} hrefFor={pageHref} label="Paginación de las recetas de la jornada" />
                </div>
              </div>
            </section>
          </div>

          {mostrarFirma ? (
            <aside className="split-aside" aria-label="Firma de la jornada">
              <FirmarForm fecha={laMasAntigua.fecha} fueraDeTermino={laMasAntigua.fueraDeTermino} />
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
