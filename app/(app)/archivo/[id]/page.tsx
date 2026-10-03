/**
 * `/archivo/[id]` (FASE 12 points 12.1/12.3). Detalle del lote (recetas, timeline de estado) + acciones de destrucción.
 *
 * Layout: the lote's recetas in the main column; its data, the lifecycle timeline (en archivo -> plazo cumplido ->
 * destrucción solicitada -> autorizada -> destruido) and the one destrucción step the current estado allows in the
 * aside.
 */
import { notFound } from "next/navigation";
import { Archive, CircleCheck, Info } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { NotFoundError } from "@/shared/errors";
import { getLoteArchivoDetalle } from "@/modules/archivo/application/list-lotes";
import { ESTADOS_LOTE_ARCHIVO, ESTADO_LOTE_ARCHIVO_LABELS } from "@/modules/archivo/domain/lote-archivo";
import { SolicitarDestruccionForm, AutorizarDestruccionForm, RegistrarDestruccionForm } from "@/modules/archivo/ui/destruccion-forms";
import { tonoEstadoLote } from "@/modules/archivo/ui/estado-lote";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Avatar } from "@/shared/ui/avatar";
import { StatusBadge, ToneBadge } from "@/shared/ui/status-badge";

interface LoteDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function LoteDetallePage({ params }: LoteDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  let lote;
  try {
    lote = await getLoteArchivoDetalle(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const puedeDestruccion = can(session, "archivo.destruccion.gestionar");
  // The lifecycle in its own order (domain/lote-archivo.ts): earlier steps are done, the lote's estado is the current one.
  const pasoActual = ESTADOS_LOTE_ARCHIVO.indexOf(lote.estado);

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Archivo", href: "/archivo" }, { label: `Lote Nº ${lote.numero}` }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Lote Nº <span className="font-mono">{lote.numero}</span>
            <ToneBadge tone={tonoEstadoLote(lote.estado)}>{ESTADO_LOTE_ARCHIVO_LABELS[lote.estado]}</ToneBadge>
          </span>
        }
        description={
          <span className="meta-line">
            <span className="tabular-nums">
              {formatFechaIso(lote.periodoDesde)} a {formatFechaIso(lote.periodoHasta)}
            </span>
            <span>{lote.ubicacion}</span>
          </span>
        }
      />

      <div className="split-layout">
        <section aria-labelledby="recetas-heading" className="list-panel min-w-0">
          <div className="list-toolbar">
            <h2 id="recetas-heading" className="flex items-center gap-2 font-medium text-zinc-900">
              Recetas <span className="tab-count">{lote.recetas.length}</span>
            </h2>
          </div>
          {lote.recetas.length === 0 ? (
            <EmptyState icon={<Archive className="size-5" />} title="Sin recetas asignadas" />
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
                  </tr>
                </thead>
                <tbody>
                  {lote.recetas.map((r) => {
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="split-aside flex flex-col gap-4" aria-label="Datos y destrucción del lote">
          {lote.estaDestruido ? (
            <div role="note" className="alert alert-success">
              <CircleCheck aria-hidden />
              <p>
                Este lote fue destruido el {formatFechaIso(lote.fechaDestruccion ?? "")}. Solo se destruyeron las recetas en papel; los registros digitales se conservan.
              </p>
            </div>
          ) : (
            <div role="note" className="alert alert-info">
              <Info aria-hidden />
              <p>Se destruyen solo las recetas en papel; los registros digitales se conservan siempre.</p>
            </div>
          )}

          {puedeDestruccion && lote.puedeSolicitarDestruccion ? <SolicitarDestruccionForm loteId={lote.id} /> : null}
          {puedeDestruccion && lote.puedeAutorizarDestruccion ? <AutorizarDestruccionForm loteId={lote.id} /> : null}
          {puedeDestruccion && lote.puedeRegistrarDestruccion ? <RegistrarDestruccionForm loteId={lote.id} /> : null}

          <section className="panel" aria-labelledby="estado-lote-heading">
            <div className="panel-header">
              <h2 id="estado-lote-heading">Estado</h2>
            </div>
            <div className="panel-body">
              <ol className="timeline" aria-label="Estados del lote">
                {ESTADOS_LOTE_ARCHIVO.map((estado, i) => (
                  <li key={estado} data-state={i < pasoActual ? "done" : undefined} aria-current={i === pasoActual ? "step" : undefined}>
                    <span className="stepper-dot" aria-hidden>
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{ESTADO_LOTE_ARCHIVO_LABELS[estado]}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="panel" aria-labelledby="datos-lote-heading">
            <div className="panel-header">
              <h2 id="datos-lote-heading">Datos</h2>
            </div>
            <div className="panel-body">
              <dl className="summary-dl">
                <dt>Ubicación</dt>
                <dd title={lote.ubicacion}>{lote.ubicacion}</dd>
                <dt>Controladas</dt>
                <dd>{lote.incluyeControladas ? "Incluye" : "No incluye"}</dd>
                <dt>Vencimiento</dt>
                <dd className={`tabular-nums ${lote.plazoCumplido ? "font-medium text-amber-700" : ""}`}>
                  {formatFechaIso(lote.vencimiento)}
                  {lote.plazoCumplido && lote.estado === "EN_ARCHIVO" ? ", plazo cumplido" : ""}
                </dd>
                <dt>Registrado por</dt>
                <dd>
                  {lote.registradoPorApellido}, {lote.registradoPorNombre}
                </dd>
                {lote.expedienteAutorizacion ? (
                  <>
                    <dt>Expediente</dt>
                    <dd className="font-mono">{lote.expedienteAutorizacion}</dd>
                  </>
                ) : null}
                {lote.fechaAutorizacion ? (
                  <>
                    <dt>Autorización</dt>
                    <dd className="tabular-nums">{formatFechaIso(lote.fechaAutorizacion)}</dd>
                  </>
                ) : null}
                {lote.fechaDestruccion ? (
                  <>
                    <dt>Destrucción</dt>
                    <dd className="tabular-nums">{formatFechaIso(lote.fechaDestruccion)}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
