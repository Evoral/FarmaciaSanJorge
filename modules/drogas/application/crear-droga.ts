/**
 * `crearDroga` (M06, FASE 4 point 4.2, INV-F03/droga_es_controlada_check).
 * FAR/DT/ADM (plan §7). `unidadBaseId` must reference an existing,
 * non-baja unidad de medida -- the DB's FK only requires "exists" (any
 * unidad, even one already given de baja); this command additionally
 * rejects a baja unidad with a clear Spanish message rather than letting
 * the picker's own filtering (UI-only) be the sole defense.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { TIPOS_CONTROL, tipoControlValido, nonNegativeDecimalString } from "../domain/droga";
import { existeNombreVigente, insertDroga } from "../infrastructure/droga-repository";

const crearDrogaInput = z.object({
  nombre: nonEmptyString,
  unidadBaseId: uuid,
  esControlada: z.boolean().default(false),
  tipoControl: z.enum(TIPOS_CONTROL).default("NINGUNO"),
  stockMinimo: nonNegativeDecimalString,
});

/** PRE-parse shape -- see modules/unidades/application/crear-unidad.ts's `CrearUnidadInput` doc comment for why this is hand-written (stockMinimo is a raw string here, a `Decimal` only after the zod schema's own transform). */
export interface CrearDrogaInput {
  nombre: string;
  unidadBaseId: string;
  esControlada?: boolean;
  tipoControl?: string;
  stockMinimo: string;
}

export const crearDrogaCommand = defineCommand({
  name: "drogas.crear",
  permiso: "drogas.crear",
  input: crearDrogaInput,
  audit: { entidad: "droga", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    if (!tipoControlValido(input.esControlada, input.tipoControl)) {
      throw new ValidationError('El tipo de control debe ser "Ninguno" si y solo si la droga no es controlada.');
    }

    const unidad = await tx.unidadMedida.findUnique({ where: { id: input.unidadBaseId }, select: { id: true, fechaBaja: true } });
    if (!unidad) throw new NotFoundError("Unidad de medida no encontrada.");
    if (unidad.fechaBaja !== null) throw new DomainError("La unidad de medida elegida está dada de baja.");

    if (await existeNombreVigente(tx, session.tenantId, input.nombre)) {
      throw new ValidationError("Ya existe una droga con ese nombre.");
    }

    const nueva = await insertDroga(tx, {
      tenantId: session.tenantId,
      nombre: input.nombre,
      unidadBaseId: input.unidadBaseId,
      esControlada: input.esControlada,
      tipoControl: input.tipoControl,
      stockMinimo: input.stockMinimo.toString(),
    });

    return {
      output: { id: nueva.id },
      audit: {
        entidadId: nueva.id,
        valorNuevo: {
          nombre: input.nombre,
          unidadBaseId: input.unidadBaseId,
          esControlada: input.esControlada,
          tipoControl: input.tipoControl,
          stockMinimo: input.stockMinimo.toString(),
        },
      },
    };
  },
});

export async function crearDroga(input: CrearDrogaInput): Promise<{ id: string }> {
  return crearDrogaCommand.execute(input);
}
