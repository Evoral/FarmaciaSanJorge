/**
 * `registrarPerdidaReserva`: the toma workspace's "Registrar pérdida" on an
 * ítem whose stock is reserved (docs/specs/reserva-stock-preparacion.md) --
 * whoever prepares records that part of a reserved partida was lost (rotura,
 * derrame) during the lab's work. ONE transaction:
 *   1. Lock the preparación, then its receta, then EVERY partida it reserves
 *      (one id-ordered statement): the same order as "Imprimir etiqueta"
 *      (`confirmarReservaStock`), and the partidas before any single one, so
 *      it can not deadlock with a reserva or a confirmation.
 *   2. The partida must be one this preparación reserves.
 *   3. An AJUSTE through the stock module's own code
 *      (`registrarAjusteEnTx`, modules/stock/application/registrar-ajuste.ts:
 *      unit, saldo, reserva check, INSERT -- the DB's INV-U05 DT check and the
 *      deferred INV-L08 contralor check behave exactly as for any ajuste),
 *      LINKED to the preparación (`movimiento_stock.preparacion_id`) and
 *      allowed to consume this preparación's OWN reserva (never another's).
 *   4. The receta still needs the full amount, so the reserva is re-planned
 *      with the same choice (`planificarConsumoEnTx`): if the chosen partidas
 *      still cover it, the reserva rows are rewritten with the new split
 *      (same partidas, amounts updated); if not, the pérdida still persists,
 *      the old rows stay, and the ítem shows "La reserva ya no alcanza:
 *      modificá la reserva" until "Modificar reserva" fixes it ("Imprimir
 *      etiqueta" fails with the stock message meanwhile).
 *
 * An AJUSTE needs a Director Técnico's authorization (INV-S08/INV-U05: the
 * DB requires `autorizado_por_id` = a DT vigente), so the form carries the
 * same "co-firma en el mismo acto" as the stock ajuste. Same structure as
 * `registrarAjusteStock` (FIX 4): the exported entry point takes the DT's
 * credentials, verifies them in their own transaction
 * (`verificarCoFirmaPerdidaCommand`, this module's own instance of the stock
 * co-firma, permiso `preparaciones.confirmar`), and only then runs the
 * internal, NOT exported, command with the id THAT verification returned.
 * The DT's password is the only credential asked: no operator
 * re-authentication on top of it (user decision, 2026-10-08).
 *
 * Permiso `preparaciones.confirmar` (the one used to reserve), NOT
 * `stock.ajuste.registrar`. Audited as CREAR on the movimiento.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString, positiveDecimalString } from "@/shared/validation";
import { registrarAjusteEnTx } from "@/modules/stock/application/registrar-ajuste";
import { verificarCoFirmaDtEnTx } from "@/modules/stock/application/verificar-co-firma-dt";
import { MOTIVOS_PERDIDA, type MotivoPerdida } from "../domain/perdida";
import { planificarConsumoEnTx } from "./confirmar-preparacion";
import { lineasDesdeReservas } from "./confirmar-reserva-stock";
import { reservasDelPlan } from "./reservar-stock-preparacion";
import {
  deleteReservasDePreparacion,
  getPreparacionParaAccion,
  getRecetaContextoAsiento,
  insertReservas,
  jornadaActualTenant,
  listReservasDePreparacion,
  lockPartidasParaConfirmacion,
  lockPreparacionParaAccion,
  lockRecetaParaTransicion,
} from "../infrastructure/preparacion-repository";


const registrarPerdidaInternalInput = z.object({
  preparacionId: uuid,
  partidaId: uuid,
  /** In the droga's unidad base. */
  cantidad: positiveDecimalString,
  motivoAjuste: z.enum(MOTIVOS_PERDIDA),
  observacion: nonEmptyString.optional(),
  /** Set ONLY by `registrarPerdidaReserva`, from the co-firma verification -- never from client input. */
  autorizadoPorId: uuid,
});

export interface RegistrarPerdidaReservaInput {
  preparacionId: string;
  partidaId: string;
  cantidad: string;
  motivoAjuste: MotivoPerdida;
  observacion?: string;
  dtUsuarioId: string;
  dtPassword: string;
}

export interface PerdidaRegistrada {
  id: string;
  /** The same partidas still cover the receta (the reserva was re-planned); `false` = "Modificar reserva". */
  reservaAlcanza: boolean;
}

/** This module's own instance of the stock co-firma (permiso `preparaciones.confirmar`) -- see this file's doc comment. */
export const verificarCoFirmaPerdidaCommand = defineCommand({
  name: "preparaciones.perdida.verificarCoFirmaDt",
  permiso: "preparaciones.confirmar",
  input: z.object({ dtUsuarioId: uuid, password: z.string().min(1) }),
  audit: { skip: true, reason: "Audits CONDITIONALLY (failed attempts only) inside verificarCoFirmaDtEnTx -- see modules/stock/application/verificar-co-firma-dt.ts." },
  handler: async ({ tx, session, input }) => ({ output: await verificarCoFirmaDtEnTx(tx, session, input) }),
});

/** NOT exported -- the only way to reach it is `registrarPerdidaReserva`, below. */
const registrarPerdidaInternalCommand = defineCommand({
  name: "preparaciones.registrarPerdida",
  permiso: "preparaciones.confirmar",
  input: registrarPerdidaInternalInput,
  audit: { entidad: "movimiento_stock", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    // 1. Locks: preparación -> receta -> every reserved partida (id order).
    if (!(await lockPreparacionParaAccion(tx, session.tenantId, input.preparacionId))) {
      throw new NotFoundError("Preparación no encontrada.");
    }
    const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    if (!preparacion) throw new NotFoundError("Preparación no encontrada.");
    if (preparacion.estado !== "INICIADA") {
      throw new DomainError(`Esta preparación ya no está INICIADA (estado actual: ${preparacion.estado}).`);
    }
    const contexto = await getRecetaContextoAsiento(tx, session.tenantId, preparacion.itemRecetaId);
    if (contexto) await lockRecetaParaTransicion(tx, session.tenantId, contexto.recetaId);

    const reservas = await listReservasDePreparacion(tx, session.tenantId, input.preparacionId);
    if (reservas.length === 0) throw new DomainError("Esta preparación no tiene stock reservado.");
    await lockPartidasParaConfirmacion(tx, session.tenantId, [...new Set(reservas.map((r) => r.partidaId))]);

    // 2. Only a partida this preparación reserves.
    if (!reservas.some((r) => r.partidaId === input.partidaId)) {
      throw new DomainError("La partida elegida no está reservada para esta preparación.", { fields: ["partidaId"] });
    }

    // 3. The AJUSTE, linked to the preparación (may consume its own reserva).
    const ajuste = await registrarAjusteEnTx(tx, session, {
      partidaId: input.partidaId,
      cantidad: input.cantidad,
      motivoAjuste: input.motivoAjuste,
      observacion: input.observacion ?? "Pérdida durante la preparación.",
      autorizadoPorId: input.autorizadoPorId,
      preparacionId: input.preparacionId,
    });

    // 4. Re-plan the same choice against the new balances.
    let reservaAlcanza = true;
    try {
      const plan = await planificarConsumoEnTx(tx, session.tenantId, {
        preparacionId: input.preparacionId,
        fichaTecnicaId: preparacion.fichaTecnicaId,
        lineas: lineasDesdeReservas(reservas),
        jornada: await jornadaActualTenant(tx, session.tenantId),
      });
      await deleteReservasDePreparacion(tx, session.tenantId, input.preparacionId);
      await insertReservas(tx, { tenantId: session.tenantId, preparacionId: input.preparacionId, reservadaPorId: session.usuario.id, reservas: reservasDelPlan(plan) });
    } catch (e) {
      // The planner only throws its own checks (it writes nothing): the pérdida stands, the reserva stays as it was.
      if (!(e instanceof DomainError || e instanceof NotFoundError)) throw e;
      reservaAlcanza = false;
    }

    return {
      output: { id: ajuste.id, reservaAlcanza } satisfies PerdidaRegistrada,
      audit: {
        entidadId: ajuste.id,
        valorNuevo: { ...ajuste.valorNuevo, reservaAlcanza },
        autorizadoPorId: input.autorizadoPorId,
      },
    };
  },
});

/**
 * The ONLY exported entry point: verifies the DT's co-firma FIRST (own transaction, rate-limited, failures audited),
 * then runs the internal command with the id THAT verification returned -- same as `registrarAjusteStock`.
 */
export async function registrarPerdidaReserva(input: RegistrarPerdidaReservaInput): Promise<PerdidaRegistrada> {
  const coFirma = await verificarCoFirmaPerdidaCommand.execute({ dtUsuarioId: input.dtUsuarioId, password: input.dtPassword });
  if (!coFirma.ok) throw new DomainError(coFirma.message);
  return registrarPerdidaInternalCommand.execute({
    preparacionId: input.preparacionId,
    partidaId: input.partidaId,
    cantidad: input.cantidad,
    motivoAjuste: input.motivoAjuste,
    observacion: input.observacion,
    autorizadoPorId: coFirma.dtUsuarioId,
  });
}
