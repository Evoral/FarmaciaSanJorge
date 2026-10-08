/**
 * `/recetas/[id]` (FASE 6 points 6.3/6.5): detalle, anulación, link a edición.
 *
 * Layout: who (paciente/médico) and what (ítems with their componentes) in
 * the main column; the record's data and the irreversible anulación zone in
 * the aside. An anulada receta shows its motivo first.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Calculator, ExternalLink, FileText, Lock, Pencil, Stethoscope } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { ORIGEN_RECETA_LABELS, esEstadoEditable, esEstadoTerminal, puedeAnular } from "@/modules/recetas/domain/receta";
import { anularRecetaAction } from "@/modules/recetas/ui/actions";
import { PARAM_AVISO, decodificarAvisos } from "@/modules/recetas/domain/avisos-generacion";
import { AvisosGeneracion } from "@/modules/recetas/ui/avisos-generacion";
import { AYUDA_ANULACION_PERMITIDA, MENSAJE_ANULACION_BLOQUEADA_POR_LIBRO, decidirAnulacion, mensajePreparacionEnCurso } from "@/modules/recetas/domain/anulacion";
import { MotivoForm } from "@/shared/ui/motivo-form";
import { StatusBadge, ToneBadge } from "@/shared/ui/status-badge";
import { ESTADO_RECETA_LABELS, FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";
import { ComponentesTabla } from "@/modules/recetas/ui/componentes-tabla";
import { formatFecha } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { Avatar } from "@/shared/ui/avatar";

interface RecetaDetallePageProps {
  params: Promise<{ id: string }>;
  /** `aviso`: notices from the automatic ficha/cotización generation after confirming/editing (codes only -- modules/recetas/domain/avisos-generacion.ts). */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RecetaDetallePage({ params, searchParams }: RecetaDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const receta = await getReceta(id);
  if (!receta) notFound();

  const avisos = decodificarAvisos((await searchParams)[PARAM_AVISO], receta.items.length);

  // A PENDIENTE_PREPARACION receta may hold a preparación INICIADA (a reserva de stock): not editable until released.
  const puedeEditar = can(session, "recetas.editar") && esEstadoEditable(receta.estado) && receta.itemsConPreparacionIniciada.length === 0;
  const puedeAnularReceta = can(session, "recetas.anular") && puedeAnular(receta.estado);
  // Same decision the anular command enforces (domain/anulacion.ts): the libro may forbid a direct anulación.
  const anulacion = decidirAnulacion({
    estado: receta.estado,
    itemIds: receta.items.map((i) => i.id),
    asientosEnEfecto: receta.asientosEnEfecto,
    itemsConPreparacionIniciada: receta.itemsConPreparacionIniciada,
  });
  const puedeVerLibro = can(session, "libro.ver");
  const puedeVerFichas = can(session, "fichas.generar") || can(session, "fichas.imprimir");
  const puedeVerCotizacion = can(session, "cotizaciones.calcular") || can(session, "cotizaciones.ver");

  const paciente = `${receta.pacienteNombre} ${receta.pacienteApellido}`;
  const diagnostico = [receta.diagnosticoCodigo, receta.diagnosticoDescripcion].filter(Boolean).join(" - ");
  const urlVerificacion = receta.urlVerificacion && /^https?:\/\//i.test(receta.urlVerificacion) ? receta.urlVerificacion : null;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Recetas", href: "/recetas" }, { label: `Nº ${receta.numeroInterno}` }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Receta Nº <span className="font-mono">{receta.numeroInterno}</span>
            <StatusBadge estado={receta.estado} />
          </span>
        }
        actions={
          puedeEditar ? (
            <Link href={`/recetas/${receta.id}/editar`} className="btn btn-secondary">
              <Pencil className="size-4" aria-hidden />
              Editar
            </Link>
          ) : null
        }
      />

      <AvisosGeneracion avisos={avisos} />

      <div className="split-layout">
        <div className="flex min-w-0 flex-col gap-6">
          {receta.motivoAnulacion ? (
            <div role="note" className="alert alert-danger">
              <Ban aria-hidden />
              <p>
                <strong className="font-semibold">Receta anulada.</strong> Motivo: {receta.motivoAnulacion}
              </p>
            </div>
          ) : null}

          <section aria-label="Paciente y médico" className="panel">
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <div className="person-block">
                <Avatar name={paciente} />
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500">Paciente</p>
                  <p className="truncate font-medium text-zinc-900">{paciente}</p>
                  {receta.domicilioPaciente ? <p className="text-xs text-zinc-500">Domicilio: {receta.domicilioPaciente}</p> : null}
                </div>
              </div>
              <div className="person-block">
                <span className="tone-tile" aria-hidden>
                  <Stethoscope />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500">Médico</p>
                  <p className="truncate font-medium text-zinc-900">
                    {receta.medicoApellido}, {receta.medicoNombre}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Matrícula <span className="font-mono">{receta.medicoMatricula}</span>
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="items-heading" className="flex flex-col gap-4">
            <div className="section-heading mb-0">
              <h2 id="items-heading" className="flex items-center gap-2">
                Ítems <span className="tab-count">{receta.items.length}</span>
              </h2>
            </div>
            {receta.items.map((item, idx) => (
              <article key={item.id} className="group-card" aria-labelledby={`item-${item.id}`}>
                <div className="group-card-header flex-wrap">
                  <span className="index-badge" aria-hidden>
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 id={`item-${item.id}`} className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900">
                      <span className="sr-only">Ítem {idx + 1}:</span>
                      {item.descripcion ?? FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]}
                      {item.estadoAsiento === "SIN_EFECTO" ? <ToneBadge tone="warn">Sin efecto</ToneBadge> : null}
                    </h3>
                    <p className="meta-line mt-0.5 text-xs">
                      <span>{FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]}</span>
                      <span className="tabular-nums">
                        {item.cantidadUnidades} {item.cantidadUnidades === 1 ? "unidad" : "unidades"}
                      </span>
                      {item.cantidadTotal ? (
                        <span className="tabular-nums">
                          Total {item.cantidadTotal} {item.unidadTotalSimbolo ?? ""}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {puedeVerFichas || puedeVerCotizacion ? (
                    <div className="flex flex-wrap gap-1">
                      {puedeVerFichas ? (
                        <Link href={`/recetas/${receta.id}/items/${item.id}/ficha-tecnica`} className="btn btn-ghost btn-sm">
                          <FileText className="size-3.5" aria-hidden />
                          Ficha técnica
                        </Link>
                      ) : null}
                      {puedeVerCotizacion ? (
                        <Link href={`/recetas/${receta.id}/items/${item.id}/cotizacion`} className="btn btn-ghost btn-sm">
                          <Calculator className="size-3.5" aria-hidden />
                          Cotización
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-3 p-4">
                  {item.posologia || item.duracionTratamientoDias ? (
                    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                      {item.posologia ? (
                        <div>
                          <dt className="text-xs text-zinc-500">Posología</dt>
                          <dd className="text-zinc-900">{item.posologia}</dd>
                        </div>
                      ) : null}
                      {item.duracionTratamientoDias ? (
                        <div>
                          <dt className="text-xs text-zinc-500">Tratamiento</dt>
                          <dd className="text-zinc-900 tabular-nums">
                            {item.duracionTratamientoDias} {item.duracionTratamientoDias === 1 ? "día" : "días"}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  <ComponentesTabla componentes={item.componentes} />
                </div>
              </article>
            ))}
          </section>
        </div>

        <aside className="split-aside flex flex-col gap-4" aria-label="Datos de la receta">
          <section className="panel" aria-labelledby="datos-heading">
            <div className="panel-header">
              <h2 id="datos-heading">Datos</h2>
            </div>
            <div className="panel-body">
              <dl className="summary-dl">
                <dt>Estado</dt>
                <dd>{ESTADO_RECETA_LABELS[receta.estado]}</dd>
                <dt>Origen</dt>
                <dd>{ORIGEN_RECETA_LABELS[receta.origen]}</dd>
                {receta.emisor ? (
                  <>
                    <dt>Emisor</dt>
                    <dd title={`${receta.emisor} Nº ${receta.nroRecetaEmisor ?? ""}`}>
                      {receta.emisor} Nº {receta.nroRecetaEmisor}
                    </dd>
                  </>
                ) : null}
                <dt>Prescripción</dt>
                <dd className="tabular-nums">{formatFecha(receta.fechaPrescripcion)}</dd>
                <dt>Ingreso</dt>
                <dd className="tabular-nums">{formatFecha(receta.fechaIngreso)}</dd>
                <dt>Registrada por</dt>
                <dd title={receta.registradaPorNombre}>{receta.registradaPorNombre}</dd>
              </dl>
              {receta.emisor && urlVerificacion ? (
                <a href={urlVerificacion} target="_blank" rel="noopener noreferrer" className="link-button mt-3">
                  <ExternalLink className="size-3.5" aria-hidden />
                  Verificar en el emisor
                </a>
              ) : null}
              {diagnostico ? (
                <div className="mt-4 border-t border-zinc-100 pt-3 text-sm">
                  <p className="text-xs text-zinc-500">Diagnóstico</p>
                  <p className="text-zinc-900">{diagnostico}</p>
                </div>
              ) : null}
            </div>
          </section>

          {puedeAnularReceta ? (
            <section className="panel" data-tone="danger" aria-labelledby="anulacion-heading">
              <div className="panel-header">
                <h2 id="anulacion-heading">Anulación</h2>
              </div>
              <div className="panel-body text-sm">
                {anulacion.tipo === "bloqueada-libro" ? (
                  <>
                    <p className="mb-2 text-zinc-700">{MENSAJE_ANULACION_BLOQUEADA_POR_LIBRO}</p>
                    <ul className="flex flex-col gap-1">
                      {anulacion.asientos.map((a) => (
                        <li key={a.asientoId}>
                          {puedeVerLibro ? (
                            <Link href={`/libro/${a.asientoId}`} className="link-button">
                              Asiento Nº {a.numeroCorrelativo} (ítem {a.item})
                            </Link>
                          ) : (
                            <span className="text-zinc-900">
                              Asiento Nº {a.numeroCorrelativo} (ítem {a.item})
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : anulacion.tipo === "bloqueada-preparacion" ? (
                  <p className="text-zinc-700">{mensajePreparacionEnCurso(anulacion.item)}</p>
                ) : (
                  <MotivoForm
                    action={anularRecetaAction}
                    id={receta.id}
                    label="Anular receta"
                    pendingLabel="Anulando…"
                    helpText={AYUDA_ANULACION_PERMITIDA}
                    variant="danger"
                  />
                )}
              </div>
            </section>
          ) : null}

          {esEstadoTerminal(receta.estado) && !puedeAnularReceta ? (
            <p className="flex items-start gap-2 text-sm text-zinc-500">
              <Lock className="mt-0.5 size-4 flex-none" aria-hidden />
              La receta está {ESTADO_RECETA_LABELS[receta.estado].toLowerCase()}; no admite más cambios.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
