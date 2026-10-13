/**
 * `marcarPartidaVencida` (docs/specs/reanalisis-partida.md). The Director
 * Técnico vigente decides that an expired DROGA partida will not be
 * re-analysed: its WHOLE remaining saldo is discounted with an AJUSTE of
 * motivo VENCIMIENTO and the partida is terminal (saldo 0: it can never
 * regain stock -- DP-21b -- and the DB refuses a reanálisis without saldo,
 * INV-S22). No new estado: saldo 0 already is the terminal state.
 *
 * The movement is the stock ajuste itself (`registrarAjusteEnTx`,
 * ./registrar-ajuste.ts: lock, fresh read, saldo + reserva checks, INSERT;
 * the DB's INV-U05 checks the DT on `autorizado_por_id` and the deferred
 * INV-L08 contralor check behaves as for any ajuste) -- no stock movement
 * code of its own. The quantity is the partida's saldo read AFTER its lock,
 * in its unidad base, never a client value. Stock reserved by a preparación
 * INICIADA is not free: the ajuste refuses it with the recetas holding it
 * (release that reserva first).
 *
 * Same verify-then-internal-command shape as ./reanalizar-partida.ts: the
 * session's usuario IS the DT (own password, `verificarPasswordDtPartidaCommand`),
 * so `autorizado_por_id` = `registrado_por_id` = `session.usuario.id`.
 * Audited as CREAR on the movimiento, like every ajuste.
 */
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { dec } from "@/shared/decimal";
import { MENSAJES_RECHAZO_MARCAR_VENCIDA, OBSERVACION_MARCAR_VENCIDA, marcarVencidaCampos, rechazoMarcarVencida } from "../domain/vencimiento-partida";
import { getPartidaParaAccion, jornadaActualTenant, lockPartidaParaAccion } from "../infrastructure/partida-repository";
import { esDtVigenteHoy } from "../infrastructure/co-firma-repository";
import { registrarAjusteEnTx } from "./registrar-ajuste";
import { verificarPasswordDtPartidaCommand } from "./verificar-password-dt-partida";

const marcarVencidaInternalInput = marcarVencidaCampos.extend({ partidaId: uuid });

export interface MarcarPartidaVencidaInput {
  partidaId: string;
  observacion?: string;
  /** The session DT's OWN password. */
  password: string;
}

function fechaIso(fecha: Date | null): string | null {
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

/** NOT exported -- reachable only through `marcarPartidaVencida`, below. */
const marcarPartidaVencidaInternalCommand = defineCommand({
  name: "stock.partida.marcarVencida",
  permiso: "stock.ajuste.autorizar",
  input: marcarVencidaInternalInput,
  audit: { entidad: "movimiento_stock", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    if (!(await lockPartidaParaAccion(tx, session.tenantId, input.partidaId))) throw new NotFoundError("Partida no encontrada.");
    const partida = await getPartidaParaAccion(tx, session.tenantId, input.partidaId);
    if (!partida) throw new NotFoundError("Partida no encontrada.");

    if (!(await esDtVigenteHoy(tx, session.tenantId, session.usuario.id))) {
      throw new DomainError("Solo el Director Técnico vigente (titular o suplente) puede marcar una partida como vencida.");
    }

    const saldo = dec(partida.cantidadDisponible);
    const rechazo = rechazoMarcarVencida(
      { drogaClase: partida.drogaClase, tieneSaldo: saldo.greaterThan(0), fechaVencimientoVigente: fechaIso(partida.fechaVencimientoVigente) },
      await jornadaActualTenant(tx, session.tenantId),
    );
    if (rechazo) throw new DomainError(MENSAJES_RECHAZO_MARCAR_VENCIDA[rechazo]);

    // The whole saldo, in the droga's unidad base (unidadId omitted), read after the lock above.
    const ajuste = await registrarAjusteEnTx(tx, session, {
      partidaId: partida.id,
      cantidad: saldo,
      motivoAjuste: "VENCIMIENTO",
      observacion: input.observacion ?? OBSERVACION_MARCAR_VENCIDA,
      autorizadoPorId: session.usuario.id,
    });

    return {
      output: { id: ajuste.id },
      audit: {
        entidadId: ajuste.id,
        motivo: "Partida marcada como vencida por el Director Técnico.",
        valorNuevo: { ...ajuste.valorNuevo, fechaVencimientoVigente: fechaIso(partida.fechaVencimientoVigente) },
        autorizadoPorId: session.usuario.id,
      },
    };
  },
});

/**
 * The ONLY exported entry point: verifies the session DT's own password FIRST (own transaction, rate-limited,
 * failures audited), then runs the internal command. `options` exists solely so unit tests can inject a session.
 */
export async function marcarPartidaVencida(input: MarcarPartidaVencidaInput, options?: ExecuteOptions): Promise<{ id: string }> {
  const verificacion = await verificarPasswordDtPartidaCommand.execute({ password: input.password }, options);
  if (!verificacion.ok) throw new DomainError(verificacion.message, { fields: ["password"] });
  return marcarPartidaVencidaInternalCommand.execute({ partidaId: input.partidaId, observacion: input.observacion }, options);
}
