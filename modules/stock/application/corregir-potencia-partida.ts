/**
 * `corregirPotenciaPartida` (openspec/changes/corregir-potencia-partida/proposal.md).
 * Allows correcting the declared purity (`potencia_declarada`, percent) of an existing
 * lot. Affects ONLY future preparations; past consumptions already took an immutable
 * snapshot (`movimiento_stock.potencia_aplicada`) and remain unaffected.
 *
 * Motivo required, audited with old and new values.
 * Blocked if the partida has active reservations (`cantidadReservada > 0`) in an
 * in-progress preparation (`INICIADA`).
 * Lock-before-read (`lockPartidaParaAccion`) + optimistic concurrency check.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ConflictError, DomainError, NotFoundError } from "@/shared/errors";
import { uuid, nonEmptyString } from "@/shared/validation";
import { interpretarNumero } from "@/shared/decimal/numero-ingresado";
import { Decimal, dec } from "@/shared/decimal";
import {
  lockPartidaParaAccion,
  getPartidaParaAccion,
  getReservadoEnPreparacion,
  updatePotenciaPartida,
} from "../infrastructure/partida-repository";

export const corregirPotenciaPartidaInput = z.object({
  id: uuid,
  /**
   * New declared purity (percent).
   * Empty string, undefined, or "100" maps to null (100% / sin corrección).
   * Valid range: 0 < p <= 100.
   */
  potenciaDeclaradaNueva: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === null || value === "") return null;
      const numero = interpretarNumero(value);
      if (!numero.ok) {
        ctx.addIssue({ code: "custom", message: numero.mensaje });
        return z.NEVER;
      }
      const parsed = new Decimal(numero.valor);
      if (!parsed.isFinite() || !parsed.greaterThan(0) || parsed.greaterThan(100)) {
        ctx.addIssue({ code: "custom", message: "La pureza debe ser mayor que 0 y como máximo 100 %." });
        return z.NEVER;
      }
      return parsed.equals(100) ? null : parsed.toString();
    }),
  motivo: nonEmptyString,
});

export interface CorregirPotenciaPartidaInput {
  id: string;
  potenciaDeclaradaNueva?: string | null;
  motivo: string;
}

export const corregirPotenciaPartidaCommand = defineCommand({
  name: "stock.partida.potencia.corregir",
  permiso: "stock.partida.potencia.corregir",
  input: corregirPotenciaPartidaInput,
  audit: { entidad: "partida", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockPartidaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Partida no encontrada.");

    const partida = await getPartidaParaAccion(tx, session.tenantId, input.id);
    if (!partida) throw new NotFoundError("Partida no encontrada.");

    // Guard: cannot correct purity if the partida is currently reserved in an in-progress preparation
    const reservado = await getReservadoEnPreparacion(tx, session.tenantId, input.id);
    if (dec(reservado.cantidad).greaterThan(0)) {
      throw new DomainError(
        "No se puede corregir la pureza: la partida tiene reservas activas en preparaciones en curso. Confirmá o descartá las preparaciones antes de corregir la pureza.",
        { fields: ["potenciaDeclaradaNueva"] },
      );
    }

    const potenciaNueva = input.potenciaDeclaradaNueva;
    const potenciaAnterior = partida.potenciaDeclarada;

    const updated = await updatePotenciaPartida(tx, {
      tenantId: session.tenantId,
      id: input.id,
      potenciaNueva,
      potenciaAnterior,
    });
    if (!updated) {
      throw new ConflictError("La partida fue modificada por otra operación. Volvé a intentarlo.");
    }

    return {
      output: { id: input.id, potenciaDeclarada: potenciaNueva },
      audit: {
        entidadId: input.id,
        valorAnterior: { potenciaDeclarada: potenciaAnterior },
        valorNuevo: { potenciaDeclarada: potenciaNueva },
        motivo: input.motivo,
      },
    };
  },
});

export async function corregirPotenciaPartida(input: CorregirPotenciaPartidaInput): Promise<{ id: string; potenciaDeclarada: string | null }> {
  return corregirPotenciaPartidaCommand.execute(input);
}
