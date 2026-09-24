/** `/entregas/[recetaId]` (FASE 11 points 11.1/11.2): entrega actions for one receta -- marcar lista para retirar, registrar entrega (retiro presencial / envío), confirmar firma recibida. Receta/paciente/médico/ítem display data comes straight from `modules/recetas/application/get-receta.ts` (cross-module application import, allowed); the entrega-specific bits come from `modules/entregas/application/get-entrega-estado.ts`. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { getEntregaEstado } from "@/modules/entregas/application/get-entrega-estado";
import { puedeRegistrarEntrega, puedeMarcarListaParaRetirar, puedeConfirmarFirmaRecibida } from "@/modules/entregas/domain/entrega";
import { marcarListaParaRetirarAction, confirmarFirmaRecibidaAction, registrarEntregaAction } from "@/modules/entregas/ui/actions";
import { ConfirmarForm } from "@/modules/entregas/ui/confirmar-form";
import { RegistrarEntregaForm } from "@/modules/entregas/ui/registrar-entrega-form";

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

function fecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

  return (
    <div className="p-6">
      <div className="mb-2">
        <Link href="/entregas" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-semibold">Entrega — Receta Nº {receta.numeroInterno}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {receta.pacienteApellido}, {receta.pacienteNombre} — Dr./Dra. {receta.medicoApellido}, {receta.medicoNombre}
        </p>
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-zinc-500">Estado</dt>
          <dd className="font-medium">{ETIQUETA_ESTADO[receta.estado] ?? receta.estado}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Receta física recibida</dt>
          <dd>{receta.recetaFisicaRecibida ? `Sí (${receta.recetaFisicaRecibidaEn ? fecha(receta.recetaFisicaRecibidaEn) : ""})` : "No"}</dd>
        </div>
        {entregaEstado.entrega ? (
          <>
            <div>
              <dt className="text-zinc-500">Modalidad de entrega</dt>
              <dd>{ETIQUETA_MODALIDAD[entregaEstado.entrega.modalidad] ?? entregaEstado.entrega.modalidad}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Firma recibida</dt>
              <dd>{entregaEstado.entrega.firmaRecibida ? `Sí (${entregaEstado.entrega.firmaRecibidaEn ? fecha(entregaEstado.entrega.firmaRecibidaEn) : ""})` : "No"}</dd>
            </div>
          </>
        ) : null}
      </dl>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Ítems</h2>
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          {entregaEstado.itemsEntregables} ítem{entregaEstado.itemsEntregables === 1 ? "" : "s"} para entregar
          {entregaEstado.itemsExcluidos > 0 ? `, ${entregaEstado.itemsExcluidos} excluido${entregaEstado.itemsExcluidos === 1 ? "" : "s"}` : ""}.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {receta.items.map((item, idx) => (
            <li key={item.id}>
              Ítem {idx + 1}: {item.descripcion ?? item.formaFarmaceutica}
              {item.estadoAsiento === "SIN_EFECTO" ? (
                <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  Excluido — no se entrega
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-6">
        {mostrarMarcarLista ? (
          <div>
            <h2 className="mb-2 text-lg font-medium">Marcar lista para retirar</h2>
            <ConfirmarForm
              action={marcarListaParaRetirarAction}
              recetaId={receta.id}
              label="Marcar lista para retirar"
              pendingLabel="Marcando…"
              helpText="Pasa la receta de PREPARADA a LISTA_PARA_RETIRAR sin entregarla todavía."
            />
          </div>
        ) : null}

        {mostrarRegistrarEntrega ? (
          <div>
            <h2 className="mb-2 text-lg font-medium">Registrar entrega</h2>
            <RegistrarEntregaForm action={registrarEntregaAction} recetaId={receta.id} recetaFisicaRecibida={receta.recetaFisicaRecibida} />
          </div>
        ) : null}

        {mostrarConfirmarFirma ? (
          <div>
            <h2 className="mb-2 text-lg font-medium">Confirmar firma recibida</h2>
            <ConfirmarForm
              action={confirmarFirmaRecibidaAction}
              recetaId={receta.id}
              label="Confirmar firma recibida"
              pendingLabel="Confirmando…"
              helpText="Confirma que el repartidor trajo la constancia firmada por el paciente junto con la receta física original. Marca la receta física como recibida y pasa la receta a ENTREGADA."
            />
          </div>
        ) : null}

        {!mostrarMarcarLista && !mostrarRegistrarEntrega && !mostrarConfirmarFirma ? (
          <p className="text-sm text-zinc-500">Esta receta no admite acciones de entrega en su estado actual ({ETIQUETA_ESTADO[receta.estado] ?? receta.estado}).</p>
        ) : null}
      </section>
    </div>
  );
}
