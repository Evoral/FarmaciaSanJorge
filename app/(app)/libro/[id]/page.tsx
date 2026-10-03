/**
 * `/libro/[id]` (FASE 9, M12 points 9.1/9.2). Detalle del asiento -- snapshots, detalle, anulación/rectificativo,
 * cierre, y el formulario de anulación cuando corresponde.
 *
 * Layout: what was recorded (snapshots, fórmula, detalle) in the main column; its estado, the anulación/rectificación
 * record and the irreversible action (when allowed) in the aside.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { NotFoundError } from "@/shared/errors";
import { getAsientoRecetario } from "@/modules/libro/application/get-asiento-recetario";
import { listDtParaCoFirmaLibro } from "@/modules/libro/application/list-dt-para-co-firma";
import { resolverEstadoVisualAsiento, etiquetaEstadoVisual } from "@/modules/libro/domain/estado-visual";
import { AnularAsientoForm } from "@/modules/libro/ui/anular-asiento-form";
import { RectificarAsientoForm } from "@/modules/libro/ui/rectificar-asiento-form";
import { tonoEstadoAsiento } from "@/modules/libro/ui/libro-nav";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";

interface AsientoPageProps {
  params: Promise<{ id: string }>;
}

export default async function AsientoPage({ params }: AsientoPageProps) {
  const session = await requireSession();
  const { id } = await params;

  let asiento;
  try {
    asiento = await getAsientoRecetario(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const estadoVisual = resolverEstadoVisualAsiento({
    estado: asiento.estado,
    anulacion: asiento.anulacion,
    rectificativoNumeroCorrelativo: asiento.rectificativoNumeroCorrelativo,
  });

  const puedeAnular = can(session, "libro.anulacion.solicitar") && estadoVisual.kind === "VIGENTE" && !asiento.cierreFirmado;
  // D1 (2026-09-23): "Rectificar" shows when the asiento is SISTEMA, VIGENTE,
  // jornada SIGNED, and has no rectificativo yet (the anular form is instead
  // shown only while the jornada is open -- see the `puedeAnular` condition above).
  const puedeRectificar =
    can(session, "libro.anulacion.solicitar") &&
    asiento.origen === "SISTEMA" &&
    estadoVisual.kind === "VIGENTE" &&
    asiento.cierreFirmado &&
    asiento.rectificativoNumeroCorrelativo === null;
  const dts = puedeAnular || puedeRectificar ? await listDtParaCoFirmaLibro() : [];
  const dtOpciones = dts.map((dt) => ({ id: dt.usuarioId, label: `${dt.nombre} ${dt.apellido}` }));

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Libro", href: "/libro" }, { label: `Asiento Nº ${asiento.numeroCorrelativo}` }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Asiento Nº <span className="font-mono">{asiento.numeroCorrelativo}</span>
            <ToneBadge tone={tonoEstadoAsiento(estadoVisual.kind)}>{etiquetaEstadoVisual(estadoVisual)}</ToneBadge>
          </span>
        }
        description={
          <span className="meta-line">
            <span className="tabular-nums">{formatFechaIso(asiento.fechaAsiento)}</span>
            <span>{asiento.origen === "RECTIFICATIVO" ? `Rectifica el asiento Nº ${asiento.asientoOriginalNumeroCorrelativo}` : "Origen sistema"}</span>
            <span className="inline-flex items-center gap-1">
              {asiento.cierreFirmado ? <Lock className="size-3" aria-hidden /> : <LockOpen className="size-3" aria-hidden />}
              Jornada {asiento.cierreFirmado ? "firmada" : "abierta"}
            </span>
          </span>
        }
      />

      <div className="split-layout">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="Datos del asiento" className="panel">
            <dl className="grid gap-x-8 gap-y-4 p-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-zinc-500">Paciente</dt>
                <dd className="font-medium text-zinc-900">{asiento.pacienteTexto}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Médico</dt>
                <dd className="text-zinc-900">{asiento.medicoTexto}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-zinc-500">Ítem de la receta</dt>
                <dd className={asiento.itemLabel ? "text-zinc-900" : "text-zinc-400"}>{asiento.itemLabel ?? "Sin dato"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-zinc-500">Fórmula</dt>
                <dd className="mt-1 whitespace-pre-wrap rounded-[var(--radius-md)] bg-zinc-50 px-3 py-2 font-mono text-[0.8125rem] leading-relaxed text-zinc-900">{asiento.formulaTexto}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="detalle-heading" className="panel">
            <div className="panel-header">
              <h2 id="detalle-heading">Detalle</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-5 py-2">
                      Descripción
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Cantidad
                    </th>
                    <th scope="col" className="px-5 py-2">
                      Unidad
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {asiento.detalles.map((d) => (
                    <tr key={d.orden}>
                      <td className="px-5 py-2.5 text-zinc-900">{d.descripcion}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{d.cantidad}</td>
                      <td className="px-5 py-2.5 text-zinc-600">{d.unidadTexto}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="split-aside flex flex-col gap-4" aria-label="Estado y acciones del asiento">
          {estadoVisual.kind === "ANULADO" ? (
            <section className="panel" data-tone="danger" aria-labelledby="anulacion-heading">
              <div className="panel-header">
                <h2 id="anulacion-heading">Anulación</h2>
              </div>
              <div className="panel-body flex flex-col gap-3 text-sm">
                <p className="text-zinc-900">{estadoVisual.motivo}</p>
                <dl className="summary-dl">
                  <dt>Anulado por</dt>
                  <dd>{estadoVisual.anuladoPorNombre}</dd>
                  <dt>Autorizado por</dt>
                  <dd>{estadoVisual.autorizadoPorNombre}</dd>
                  <dt>Fecha</dt>
                  <dd className="tabular-nums">{estadoVisual.anuladoEn.toLocaleString("es-AR")}</dd>
                </dl>
              </div>
            </section>
          ) : null}

          {estadoVisual.kind === "SIN_EFECTO" ? (
            <div className="alert alert-warn">
              <p>Este asiento quedó sin efecto por el rectificativo Nº {estadoVisual.rectificativoNumeroCorrelativo}.</p>
            </div>
          ) : null}

          {asiento.origen === "RECTIFICATIVO" && asiento.rectificacion ? (
            <section className="panel" aria-labelledby="rectificacion-heading">
              <div className="panel-header">
                <h2 id="rectificacion-heading">Rectificativo del asiento Nº {asiento.asientoOriginalNumeroCorrelativo}</h2>
              </div>
              <div className="panel-body flex flex-col gap-3 text-sm">
                <p className="text-zinc-900">{asiento.rectificacion.motivo}</p>
                <dl className="summary-dl">
                  <dt>Autorizado por</dt>
                  <dd>{asiento.rectificacion.autorizadoPorNombre}</dd>
                </dl>
              </div>
            </section>
          ) : null}

          {puedeAnular ? <AnularAsientoForm asientoId={asiento.id} numeroCorrelativo={asiento.numeroCorrelativo} dts={dtOpciones} /> : null}
          {puedeRectificar ? <RectificarAsientoForm asientoOriginalId={asiento.id} numeroCorrelativo={asiento.numeroCorrelativo} dts={dtOpciones} /> : null}

          {estadoVisual.kind === "VIGENTE" && !puedeAnular && !puedeRectificar ? (
            <p className="flex items-start gap-2 text-sm text-zinc-500">
              <Lock className="mt-0.5 size-4 flex-none" aria-hidden />
              Asiento vigente. No hay acciones disponibles para tu usuario en este estado.
            </p>
          ) : null}

          <Link href="/libro" className="btn btn-ghost">
            Volver al libro
          </Link>
        </aside>
      </div>
    </div>
  );
}
