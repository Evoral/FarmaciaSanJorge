/**
 * `/entregas/[recetaId]` (FASE 11 points 11.1/11.2): entrega actions for one receta -- marcar lista para retirar,
 * registrar entrega (retiro presencial / envío), confirmar firma recibida. Receta/paciente/médico/ítem display data
 * comes straight from `modules/recetas/application/get-receta.ts` (cross-module application import, allowed); the
 * entrega-specific bits come from `modules/entregas/application/get-entrega-estado.ts`.
 *
 * Layout: who and what is delivered in the main column; the entrega's data and the actions the current estado allows
 * in the aside (the main action first).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Lock, Stethoscope } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { getEntregaEstado } from "@/modules/entregas/application/get-entrega-estado";
import { puedeRegistrarEntrega, puedeMarcarListaParaRetirar, puedeConfirmarFirmaRecibida } from "@/modules/entregas/domain/entrega";
import { marcarListaParaRetirarAction, confirmarFirmaRecibidaAction, registrarEntregaAction } from "@/modules/entregas/ui/actions";
import { ConfirmarForm } from "@/modules/entregas/ui/confirmar-form";
import { RegistrarEntregaForm } from "@/modules/entregas/ui/registrar-entrega-form";
import { FORMA_FARMACEUTICA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { formatFecha } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { Avatar } from "@/shared/ui/avatar";
import { StatusBadge, ToneBadge } from "@/shared/ui/status-badge";

interface EntregaDetallePageProps {
  params: Promise<{ recetaId: string }>;
}

const ETIQUETA_ESTADO: Record<string, string> = {
  PENDIENTE_PREPARACION: "Pendiente de preparación",
  EN_PREPARACION: "En preparación",
  PREPARADA: "Preparada",
  LISTA_PARA_RETIRAR: "Lista para retirar",
  ENVIADA_PEND_FIRMA: "Enviada, pendiente de firma",
  ENTREGADA: "Entregada",
  ANULADA: "Anulada",
};

const ETIQUETA_MODALIDAD: Record<string, string> = {
  RETIRO_PRESENCIAL: "Retiro presencial",
  ENVIO: "Envío",
};

export default async function EntregaDetallePage({ params }: EntregaDetallePageProps) {
  const session = await requireSession();
  const { recetaId } = await params;

  const receta = await getReceta(recetaId);
  if (!receta) notFound();

  const entregaEstado = await getEntregaEstado({ recetaId });

  const puedeAccionRegistrar = can(session, "entregas.registrar");
  const puedeAccionConfirmarFirma = can(session, "entregas.firma.confirmar");

  const mostrarMarcarLista = puedeAccionRegistrar && puedeMarcarListaParaRetirar(receta.estado);
  const mostrarRegistrarEntrega = puedeAccionRegistrar && puedeRegistrarEntrega(receta.estado);
  const mostrarConfirmarFirma = puedeAccionConfirmarFirma && puedeConfirmarFirmaRecibida(receta.estado);
  // The /recetas/** layout requires `recetas.crear`: only link there when it will open.
  const puedeVerReceta = can(session, "recetas.crear");

  const paciente = `${receta.pacienteNombre} ${receta.pacienteApellido}`;
  const entrega = entregaEstado.entrega;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Entregas", href: "/entregas" }, { label: `Receta Nº ${receta.numeroInterno}` }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Entrega de la receta Nº <span className="font-mono">{receta.numeroInterno}</span>
            <StatusBadge estado={receta.estado} />
          </span>
        }
        actions={
          puedeVerReceta ? (
            <Link href={`/recetas/${receta.id}`} className="btn btn-secondary">
              <FileText className="size-4" aria-hidden />
              Ver receta
            </Link>
          ) : null
        }
      />

      <div className="split-layout">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="Paciente y médico" className="panel">
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <div className="person-block">
                <Avatar name={paciente} />
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500">Paciente</p>
                  <p className="truncate font-medium text-zinc-900">{paciente}</p>
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
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="items-heading" className="panel">
            <div className="panel-header">
              <h2 id="items-heading">Ítems</h2>
              <p>
                {entregaEstado.itemsEntregables} {entregaEstado.itemsEntregables === 1 ? "ítem" : "ítems"} para entregar
                {entregaEstado.itemsExcluidos > 0 ? `, ${entregaEstado.itemsExcluidos} ${entregaEstado.itemsExcluidos === 1 ? "excluido" : "excluidos"}` : ""}.
              </p>
            </div>
            <ul>
              {receta.items.map((item, idx) => {
                const excluido = item.estadoAsiento === "SIN_EFECTO";
                return (
                  <li key={item.id} className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3 last:border-b-0">
                    <span className="index-badge" data-size="sm" aria-hidden>
                      {idx + 1}
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-sm ${excluido ? "text-zinc-400 line-through" : "font-medium text-zinc-900"}`}>
                      <span className="sr-only">Ítem {idx + 1}: </span>
                      {item.descripcion ?? etiquetaDe(FORMA_FARMACEUTICA_LABELS, item.formaFarmaceutica)}
                    </span>
                    {excluido ? <ToneBadge tone="warn">Excluido, no se entrega</ToneBadge> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="split-aside flex flex-col gap-4" aria-label="Entrega">
          {mostrarRegistrarEntrega ? (
            <section className="panel" aria-labelledby="registrar-heading">
              <div className="panel-header">
                <h2 id="registrar-heading">Registrar entrega</h2>
              </div>
              <div className="panel-body">
                <RegistrarEntregaForm action={registrarEntregaAction} recetaId={receta.id} />
              </div>
            </section>
          ) : null}

          {mostrarConfirmarFirma ? (
            <section className="panel" aria-labelledby="firma-heading">
              <div className="panel-header">
                <h2 id="firma-heading">Confirmar firma recibida</h2>
              </div>
              <div className="panel-body">
                <ConfirmarForm
                  action={confirmarFirmaRecibidaAction}
                  recetaId={receta.id}
                  label="Confirmar firma recibida"
                  pendingLabel="Confirmando…"
                  helpText="Confirma que el repartidor trajo la constancia firmada por el paciente y pasa la receta a Entregada."
                />
              </div>
            </section>
          ) : null}

          {mostrarMarcarLista ? (
            <section className="panel" aria-labelledby="lista-heading">
              <div className="panel-header">
                <h2 id="lista-heading">Marcar lista para retirar</h2>
              </div>
              <div className="panel-body">
                <ConfirmarForm
                  action={marcarListaParaRetirarAction}
                  recetaId={receta.id}
                  label="Marcar lista para retirar"
                  pendingLabel="Marcando…"
                  helpText="Pasa la receta de Preparada a Lista para retirar, sin entregarla todavía."
                />
              </div>
            </section>
          ) : null}

          {!mostrarMarcarLista && !mostrarRegistrarEntrega && !mostrarConfirmarFirma ? (
            <p className="flex items-start gap-2 text-sm text-zinc-500">
              <Lock className="mt-0.5 size-4 flex-none" aria-hidden />
              Esta receta no admite acciones de entrega en su estado actual ({ETIQUETA_ESTADO[receta.estado] ?? receta.estado}).
            </p>
          ) : null}

          <section className="panel" aria-labelledby="datos-entrega-heading">
            <div className="panel-header">
              <h2 id="datos-entrega-heading">Datos de la entrega</h2>
            </div>
            <div className="panel-body">
              <dl className="summary-dl">
                <dt>Estado</dt>
                <dd>{ETIQUETA_ESTADO[receta.estado] ?? receta.estado}</dd>
                <dt>Modalidad</dt>
                <dd data-empty={!entrega || undefined}>{entrega ? (ETIQUETA_MODALIDAD[entrega.modalidad] ?? entrega.modalidad) : "Sin registrar"}</dd>
                {entrega ? (
                  <>
                    <dt>Firma recibida</dt>
                    <dd className="tabular-nums">{entrega.firmaRecibida ? `Sí${entrega.firmaRecibidaEn ? `, ${formatFecha(entrega.firmaRecibidaEn)}` : ""}` : "No"}</dd>
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
