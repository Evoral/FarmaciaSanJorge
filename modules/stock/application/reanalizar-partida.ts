/**
 * `registrarReanalisisPartida` (docs/specs/reanalisis-partida.md, migration
 * 0074). The Director Técnico vigente re-analyses a DROGA partida (vencida,
 * por vencer or vigente) and records the new date -- the "fecha de
 * reanálisis" -- with an optional motivo and respaldo (certificado de
 * análisis / número de protocolo). The original `fecha_vencimiento` is never
 * touched: the reanálisis is an append-only row and the DB trigger moves the
 * partida's vencimiento VIGENTE, which every expiry check reads. A vencida
 * partida is usable again from that moment.
 *
 * Same "verify credentials in their own transaction, then a NON-exported
 * internal command" shape as `registrarAjusteStock` (FIX 4) and
 * `firmarCierre`: the exported entry point verifies the session DT's OWN
 * password (`verificarPasswordDtPartidaCommand`), and only on success runs
 * the internal command, which uses `session.usuario.id` as the DT -- never an
 * id from client input.
 *
 * Inside the internal command: lock the partida FIRST, then decide from a
 * fresh read (M3 discipline, as every partida write), re-check "DT vigente
 * today" for a clear message (the DB's INV-S22 trigger re-checks DT, droga,
 * saldo and date regardless), insert. Audited as CREAR on
 * `reanalisis_partida`, in the same transaction.
 */
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { MENSAJES_RECHAZO_REANALISIS, reanalisisCampos, rechazoReanalisis } from "../domain/vencimiento-partida";
import { dec } from "@/shared/decimal";
import { getPartidaParaAccion, insertReanalisis, jornadaActualTenant, lockPartidaParaAccion } from "../infrastructure/partida-repository";
import { esDtVigenteHoy } from "../infrastructure/co-firma-repository";
import { verificarPasswordDtPartidaCommand } from "./verificar-password-dt-partida";

const reanalizarInternalInput = reanalisisCampos.extend({ partidaId: uuid });

export interface RegistrarReanalisisInput {
  partidaId: string;
  /** YYYY-MM-DD, strictly after the jornada. */
  fechaReanalisis: string;
  motivo?: string;
  /** Certificado de análisis / número de protocolo. */
  respaldo?: string;
  /** The session DT's OWN password. */
  password: string;
}

function fechaIso(fecha: Date | null): string | null {
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

/** NOT exported -- reachable only through `registrarReanalisisPartida`, below. */
const reanalizarPartidaInternalCommand = defineCommand({
  name: "stock.partida.reanalizar",
  permiso: "stock.ajuste.autorizar",
  input: reanalizarInternalInput,
  audit: { entidad: "reanalisis_partida", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    if (!(await lockPartidaParaAccion(tx, session.tenantId, input.partidaId))) throw new NotFoundError("Partida no encontrada.");
    const partida = await getPartidaParaAccion(tx, session.tenantId, input.partidaId);
    if (!partida) throw new NotFoundError("Partida no encontrada.");

    if (!(await esDtVigenteHoy(tx, session.tenantId, session.usuario.id))) {
      throw new DomainError("Solo el Director Técnico vigente (titular o suplente) puede registrar un reanálisis.");
    }

    const jornada = await jornadaActualTenant(tx, session.tenantId);
    const rechazo = rechazoReanalisis(
      { drogaClase: partida.drogaClase, tieneSaldo: dec(partida.cantidadDisponible).greaterThan(0), fechaVencimientoVigente: fechaIso(partida.fechaVencimientoVigente) },
      input.fechaReanalisis,
      jornada,
    );
    if (rechazo === "FECHA_NO_FUTURA") throw new ValidationError(MENSAJES_RECHAZO_REANALISIS[rechazo], { fields: ["fechaReanalisis"] });
    if (rechazo) throw new DomainError(MENSAJES_RECHAZO_REANALISIS[rechazo]);

    const reanalisis = await insertReanalisis(tx, {
      tenantId: session.tenantId,
      partidaId: partida.id,
      fechaReanalisis: input.fechaReanalisis,
      motivo: input.motivo ?? null,
      respaldo: input.respaldo ?? null,
      registradoPorId: session.usuario.id,
    });

    return {
      output: { id: reanalisis.id },
      audit: {
        entidadId: reanalisis.id,
        motivo: input.motivo,
        valorAnterior: { fechaVencimientoVigente: reanalisis.fechaVencimientoAnterior },
        valorNuevo: {
          partidaId: partida.id,
          partida: `${partida.drogaNombre} · lote ${partida.lote}`,
          fechaVencimientoOriginal: fechaIso(partida.fechaVencimiento),
          fechaReanalisis: input.fechaReanalisis,
          ...(input.respaldo ? { respaldo: input.respaldo } : {}),
        },
      },
    };
  },
});

/**
 * The ONLY exported entry point: verifies the session DT's own password FIRST (own transaction, rate-limited,
 * failures audited), then runs the internal command. `options` exists solely so unit tests can inject a session.
 */
export async function registrarReanalisisPartida(input: RegistrarReanalisisInput, options?: ExecuteOptions): Promise<{ id: string }> {
  const verificacion = await verificarPasswordDtPartidaCommand.execute({ password: input.password }, options);
  if (!verificacion.ok) throw new DomainError(verificacion.message, { fields: ["password"] });
  return reanalizarPartidaInternalCommand.execute(
    { partidaId: input.partidaId, fechaReanalisis: input.fechaReanalisis, motivo: input.motivo, respaldo: input.respaldo },
    options,
  );
}
