/**
 * `getEntregaEstado` -- backs `/entregas/[recetaId]`'s action panel. Reads
 * the receta's own delivery-relevant state (estado, items with `estadoAsiento`) plus its `entrega` row if one already exists
 * (ENVIO awaiting firma). The full receta/paciente/médico/ítem DISPLAY data
 * itself is fetched by the page directly from
 * `modules/recetas/application/get-receta.ts` (application-layer imports
 * across modules are allowed -- only `infrastructure/` is off limits, see
 * eslint.config.mjs) -- this query only adds what that one does not
 * already return (the `entrega` row, and `itemsEntregables`/`itemsExcluidos`
 * counts).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { listDtParaCoFirmaEnTx } from "@/modules/stock/application/list-dt-para-co-firma";
import { calcularItemsEntregables, domicilioDeEnvio } from "../domain/entrega";
import { jornadaVencimientoRetiro, preparadosVencidos, puedeReactivar } from "../domain/retiro-vencido";
import type { PreparadoVencido } from "../domain/retiro-vencido";
import {
  getRecetaParaEntrega,
  getItemsParaEntrega,
  getEntregaPorReceta,
  getRepartidorDeEntrega,
  hayRepartidoresActivos,
  getDiasRetiroVencido,
  getPreparadosConVencimiento,
  getRetiroVencidoDeReceta,
  jornadaActualTenant,
  zonaHorariaTenant,
} from "../infrastructure/entrega-repository";
import type { EntregaRow, RepartidorDeEntrega } from "../infrastructure/entrega-repository";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";

const getEntregaEstadoInput = z.object({ recetaId: uuid });

/** A DT vigente the operator can pick as the co-firma of a reactivation. */
export interface DtParaReactivar {
  id: string;
  label: string;
}

/** What the entrega pop-up shows for a RETIRO_VENCIDO receta (docs/specs/retiro-vencido.md "Pantallas"). */
export interface RetiroVencidoEstado {
  /** The jornada (YYYY-MM-DD) the plazo expired on: `preparada_en` + `diasRetiroVencido`. null when the parameter is 0 now or there is no `preparada_en`. */
  vencioEl: string | null;
  /** `dias_retiro_vencido` as configured now (RV10: not what was configured when it expired). */
  diasRetiroVencido: number;
  /** RV4: in a lote de archivo, it can not be reactivated. */
  archivada: boolean;
  /** "Lote Nro X" of the lote it was archived in. */
  loteNumero: string | null;
  /** RV5: the preparados whose vencimiento already passed; any of them makes the DT's co-firma mandatory. */
  preparadosVencidos: PreparadoVencido[];
  /** The DT vigentes to pick the co-firma from; empty when there is nothing to co-sign. */
  dts: DtParaReactivar[];
  /** The operator is themselves a DT vigente (they still type their own password). */
  operadorEsDt: boolean;
}

export interface EntregaEstado {
  recetaId: string;
  estado: EstadoReceta;
  /** Migration 0071: the receta is paid. Reaching ENTREGADA requires it (INV-R14, migration 0076): a retiro presencial or a firma confirmation must mark it paid; only an ENVIO may leave unpaid. */
  pagada: boolean;
  itemsEntregables: number;
  itemsExcluidos: number;
  entrega: EntregaRow | null;
  /** Where an envío goes: `domicilioDeEnvio` of the receta (E4, docs/specs/domicilios.md); null when the receta has none. */
  domicilioEnvio: string | null;
  /** The entrega's repartidor (E5/E7); null for a retiro, for an envío registered before migration 0093, or when there is no entrega. */
  repartidor: RepartidorDeEntrega | null;
  /** The tenant has at least one active repartidor to assign to a new envío or to a change (E3). */
  hayRepartidoresActivos: boolean;
  /** Only for a RETIRO_VENCIDO receta; null in every other estado. */
  retiroVencido: RetiroVencidoEstado | null;
}

export const getEntregaEstadoQuery = defineQuery({
  name: "entregas.estado.ver",
  permiso: "entregas.registrar",
  input: getEntregaEstadoInput,
  handler: async ({ tx, session, input }): Promise<EntregaEstado> => {
    const receta = await getRecetaParaEntrega(tx, session.tenantId, input.recetaId);
    if (!receta) throw new NotFoundError("Receta no encontrada.");

    const items = await getItemsParaEntrega(tx, session.tenantId, input.recetaId);
    const entrega = await getEntregaPorReceta(tx, session.tenantId, input.recetaId);
    const { entregables, excluidos } = calcularItemsEntregables(items);

    return {
      recetaId: receta.id,
      estado: receta.estado,
      pagada: receta.pagada,
      itemsEntregables: entregables.length,
      itemsExcluidos: excluidos.length,
      entrega,
      domicilioEnvio: domicilioDeEnvio(receta.domicilioPaciente, receta.domicilioEntrega),
      repartidor: entrega?.repartidorId ? await getRepartidorDeEntrega(tx, session.tenantId, entrega.repartidorId) : null,
      hayRepartidoresActivos: await hayRepartidoresActivos(tx, session.tenantId),
      retiroVencido: receta.estado === "RETIRO_VENCIDO" ? await getRetiroVencidoEstado(tx, session, receta.id) : null,
    };
  },
});

async function getRetiroVencidoEstado(tx: Prisma.TransactionClient, session: AuthenticatedSession, recetaId: string): Promise<RetiroVencidoEstado> {
  const { tenantId } = session;
  const retiro = await getRetiroVencidoDeReceta(tx, tenantId, recetaId);
  if (!retiro) throw new NotFoundError("Receta no encontrada.");

  const dias = await getDiasRetiroVencido(tx, tenantId);
  const vencioEl = jornadaVencimientoRetiro({ preparadaEn: retiro.preparadaEn, dias, zonaHoraria: await zonaHorariaTenant(tx, tenantId) });

  const archivada = !puedeReactivar({ estado: "RETIRO_VENCIDO", loteArchivoId: retiro.loteArchivoId });
  // Same read and same jornada as the command's RV5 check, so the form asks for the co-firma exactly when the command will.
  const vencidos = archivada ? [] : preparadosVencidos(await getPreparadosConVencimiento(tx, tenantId, recetaId), await jornadaActualTenant(tx, tenantId));
  const dts = vencidos.length > 0 ? await listDtParaCoFirmaEnTx(tx, tenantId) : [];

  return {
    vencioEl,
    diasRetiroVencido: dias,
    archivada,
    loteNumero: retiro.loteNumero,
    preparadosVencidos: vencidos,
    dts: dts.map((dt) => ({ id: dt.usuarioId, label: `${dt.nombre} ${dt.apellido}` })),
    operadorEsDt: dts.some((dt) => dt.usuarioId === session.usuario.id),
  };
}

export async function getEntregaEstado(input: { recetaId: string }): Promise<EntregaEstado> {
  return getEntregaEstadoQuery.execute(input);
}
