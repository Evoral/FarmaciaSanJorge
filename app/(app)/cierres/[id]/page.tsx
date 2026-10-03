/**
 * `/cierres/[id]` (FASE 10, M13a point 10.1/10.2). Detalle del cierre (comprobante) + botón de impresión.
 *
 * Layout: the signed asientos (recetario and contralor) in the main column; who signed, when, the term status and the
 * lote hash (the integrity proof) in the aside.
 */
import { notFound } from "next/navigation";
import { BookOpen, Printer } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { NotFoundError } from "@/shared/errors";
import { getCierreDetalle } from "@/modules/cierres/application/get-cierre-detalle";
import { MOTIVO_DEMORA_LABELS, type MotivoDemoraValue } from "@/modules/cierres/domain/motivo-demora";
import { TIPO_LIBRO_LABELS, TIPO_MOVIMIENTO_CONTRALOR_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { ToneBadge } from "@/shared/ui/status-badge";

interface CierreDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function CierreDetallePage({ params }: CierreDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  let cierre;
  try {
    cierre = await getCierreDetalle(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const puedeImprimir = can(session, "cierres.imprimir");
  const motivoLabel = cierre.motivoDemora ? MOTIVO_DEMORA_LABELS[cierre.motivoDemora as MotivoDemoraValue] ?? cierre.motivoDemora : null;
  const fecha = formatFechaIso(cierre.fecha);

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Cierres", href: "/cierres" }, { label: fecha }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Cierre de la jornada <span className="font-mono">{fecha}</span>
            <ToneBadge tone={cierre.fueraDeTermino ? "warn" : "success"}>{cierre.fueraDeTermino ? "Fuera de término" : "En término"}</ToneBadge>
          </span>
        }
        actions={
          puedeImprimir ? (
            <a href={`/api/cierres/${cierre.id}/pdf`} className="btn btn-secondary">
              <Printer className="size-4" aria-hidden />
              Imprimir comprobante
            </a>
          ) : null
        }
      />

      <div className="split-layout">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="recetario-heading" className="panel">
            <div className="panel-header">
              <h2 id="recetario-heading" className="flex items-center gap-2">
                Libro recetario <span className="tab-count">{cierre.asientosRecetario.length}</span>
              </h2>
            </div>
            {cierre.asientosRecetario.length === 0 ? (
              <EmptyState icon={<BookOpen className="size-5" />} title="Sin asientos de recetario en esta jornada" />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" className="px-5 py-2">
                        Nº
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Estado
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Paciente
                      </th>
                      <th scope="col" className="hidden px-3 py-2 md:table-cell">
                        Médico
                      </th>
                      <th scope="col" className="hidden px-5 py-2 lg:table-cell">
                        Fórmula
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cierre.asientosRecetario.map((a) => (
                      <tr key={a.numeroCorrelativo} className="align-top">
                        <td className="px-5 py-2.5 font-mono font-semibold text-zinc-900 tabular-nums">{a.numeroCorrelativo}</td>
                        <td className="px-3 py-2.5">
                          <ToneBadge tone="neutral">{a.estadoVisual}</ToneBadge>
                        </td>
                        <td className="px-3 py-2.5 text-zinc-900">
                          {a.pacienteTexto}
                          <span className="block text-xs text-zinc-500 md:hidden">{a.medicoTexto}</span>
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">{a.medicoTexto}</td>
                        <td className="hidden max-w-[36ch] px-5 py-2.5 text-zinc-700 lg:table-cell">{a.formulaTexto}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="contralor-heading" className="panel">
            <div className="panel-header">
              <h2 id="contralor-heading" className="flex items-center gap-2">
                Libros contralor <span className="tab-count">{cierre.asientosContralor.length}</span>
              </h2>
            </div>
            {cierre.asientosContralor.length === 0 ? (
              <EmptyState icon={<BookOpen className="size-5" />} title="Sin asientos de contralor en esta jornada" />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" className="px-5 py-2">
                        Nº
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Libro
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Droga
                      </th>
                      <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                        Movimiento
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Cantidad
                      </th>
                      <th scope="col" className="px-5 py-2 text-right">
                        Saldo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cierre.asientosContralor.map((a, i) => (
                      <tr key={`${a.tipoLibro}-${a.numeroCorrelativo}-${i}`}>
                        <td className="px-5 py-2.5 font-mono font-semibold text-zinc-900 tabular-nums">{a.numeroCorrelativo}</td>
                        <td className="px-3 py-2.5">{etiquetaDe(TIPO_LIBRO_LABELS, a.tipoLibro)}</td>
                        <td className="px-3 py-2.5 text-zinc-900">{a.drogaDescripcion}</td>
                        <td className="hidden px-3 py-2.5 sm:table-cell">
                          <ToneBadge tone="neutral">{etiquetaDe(TIPO_MOVIMIENTO_CONTRALOR_LABELS, a.tipoMovimiento)}</ToneBadge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{a.cantidad}</td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">{a.saldoPosterior}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="split-aside flex flex-col gap-4" aria-label="Datos del cierre">
          <section className="panel" aria-labelledby="firma-heading">
            <div className="panel-header">
              <h2 id="firma-heading">Firma</h2>
            </div>
            <div className="panel-body flex flex-col gap-4">
              <dl className="summary-dl">
                <dt>Director Técnico</dt>
                <dd title={`${cierre.directorTecnicoApellido}, ${cierre.directorTecnicoNombre}`}>
                  {cierre.directorTecnicoApellido}, {cierre.directorTecnicoNombre}
                </dd>
                <dt>Matrícula</dt>
                <dd className="font-mono">{cierre.matriculaDt}</dd>
                <dt>Firmado</dt>
                <dd className="tabular-nums">{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium" }).format(cierre.fechaFirma)}</dd>
                <dt>Asientos</dt>
                <dd className="font-mono tabular-nums">{cierre.cantidadAsientos}</dd>
                <dt>Impreso</dt>
                <dd data-empty={!cierre.fechaImpresion || undefined} className="tabular-nums">
                  {cierre.fechaImpresion ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(cierre.fechaImpresion) : "Todavía no"}
                </dd>
              </dl>

              {cierre.fueraDeTermino ? (
                <div className="alert alert-warn">
                  <div>
                    <p className="font-semibold">Fuera de término</p>
                    {motivoLabel ? <p>Motivo: {motivoLabel}</p> : null}
                    {cierre.motivoDemoraDetalle ? <p className="mt-1 text-[0.8125rem]">{cierre.motivoDemoraDetalle}</p> : null}
                  </div>
                </div>
              ) : null}

              <div className="border-t border-zinc-100 pt-3">
                <p className="text-xs text-zinc-500">Hash de lote</p>
                <p className="mt-1 break-all font-mono text-[0.6875rem] leading-relaxed text-zinc-700">{cierre.hashLote}</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
