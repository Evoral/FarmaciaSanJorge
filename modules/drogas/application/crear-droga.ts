/**
 * `crearDroga` (M06, FASE 4 point 4.2, INV-F03/droga_es_controlada_check).
 * FAR/DT/ADM (plan §7). `unidadBaseId` must reference an existing,
 * non-baja unidad de medida -- the DB's FK only requires "exists" (any
 * unidad, even one already given de baja); this command additionally
 * rejects a baja unidad with a clear Spanish message rather than letting
 * the picker's own filtering (UI-only) be the sole defense. `clase`
 * (migration 0063) defaults to DROGA; an insumo cannot be controlled.
 * The name must be free after normalization: no vigente droga and no vigente
 * synonym may already hold it (docs/specs/sinonimos-droga.md; the DB
 * re-checks: migration 0067).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { CLASES_DROGA, MENSAJE_INSUMO_CONTROLADO, TIPOS_CONTROL, claseValida, tipoControlValido, nonNegativeDecimalString } from "../domain/droga";
import { mensajeConflictoNombre } from "../domain/sinonimo";
import { existeNombreVigente, insertDroga } from "../infrastructure/droga-repository";

const crearDrogaInput = z.object({
  nombre: nonEmptyString,
  unidadBaseId: uuid,
  esControlada: z.boolean().optional(),
  tipoControl: z.enum(TIPOS_CONTROL).default("NINGUNO"),
  clase: z.enum(CLASES_DROGA).default("DROGA"),
  stockMinimo: nonNegativeDecimalString,
});

/** PRE-parse shape -- see modules/unidades/application/crear-unidad.ts's `CrearUnidadInput` doc comment for why this is hand-written (stockMinimo is a raw string here, a `Decimal` only after the zod schema's own transform). */
export interface CrearDrogaInput {
  nombre: string;
  unidadBaseId: string;
  esControlada?: boolean;
  tipoControl?: string;
  clase?: string;
  stockMinimo: string;
}

export const crearDrogaCommand = defineCommand({
  name: "drogas.crear",
  permiso: "drogas.crear",
  input: crearDrogaInput,
  audit: { entidad: "droga", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    // When omitted, derived from tipoControl (same rule as the DB CHECK).
    const esControlada = input.esControlada ?? input.tipoControl !== "NINGUNO";
    if (!tipoControlValido(esControlada, input.tipoControl)) {
      throw new ValidationError('El tipo de control debe ser "Ninguno" si y solo si la droga no es controlada.');
    }
    if (!claseValida(input.clase, input.tipoControl)) throw new ValidationError(MENSAJE_INSUMO_CONTROLADO, { fields: ["clase", "tipoControl"] });

    const unidad = await tx.unidadMedida.findUnique({ where: { id: input.unidadBaseId }, select: { id: true, nombre: true, simbolo: true, fechaBaja: true } });
    if (!unidad) throw new NotFoundError("Unidad de medida no encontrada.");
    if (unidad.fechaBaja !== null) throw new DomainError("La unidad de medida elegida está dada de baja.");

    // Accent/case-insensitive, against vigente drogas AND synonyms (docs/specs/sinonimos-droga.md): another
    // name for an existing substance is a synonym of that droga, never a second droga.
    const conflicto = await existeNombreVigente(tx, session.tenantId, input.nombre);
    if (conflicto) throw new ValidationError(mensajeConflictoNombre(conflicto), { fields: ["nombre"] });

    const nueva = await insertDroga(tx, {
      tenantId: session.tenantId,
      nombre: input.nombre,
      unidadBaseId: input.unidadBaseId,
      esControlada,
      tipoControl: input.tipoControl,
      clase: input.clase,
      stockMinimo: input.stockMinimo.toString(),
    });

    return {
      output: { id: nueva.id },
      audit: {
        entidadId: nueva.id,
        valorNuevo: {
          nombre: input.nombre,
          unidadBaseId: input.unidadBaseId,
          unidadBase: `${unidad.nombre} (${unidad.simbolo})`,
          esControlada,
          tipoControl: input.tipoControl,
          clase: input.clase,
          stockMinimo: input.stockMinimo.toString(),
        },
      },
    };
  },
});

export async function crearDroga(input: CrearDrogaInput): Promise<{ id: string }> {
  return crearDrogaCommand.execute(input);
}
