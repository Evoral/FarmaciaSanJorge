/**
 * `crearUnidad` (M05, FASE 4 point 4.1, INV-M02). ADM only -- global catalog
 * (DP-39), so this command does NOT open a tenant-scoped transaction in any
 * special way; `shared/usecase.ts#defineCommand` still runs it inside
 * `withTenantTransaction(session.tenantId, ...)` (every command does, to get
 * a `tx` at all), but the handler never reads/writes `session.tenantId` --
 * `fsj.unidad_medida` has no such column.
 *
 * `esBase` on a magnitude that already has a base unit is rejected by
 * INV-M02 (migration 0006's partial unique index) -- not re-checked here,
 * surfaces as a `ConflictError` via `mapDbError`'s P2002 mapping.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ValidationError } from "@/shared/errors";
import { nonEmptyString, positiveDecimalString } from "@/shared/validation";
import { TIPOS_MAGNITUD, esBaseValido } from "../domain/unidad";
import { existeCodigo, insertUnidad } from "../infrastructure/unidad-repository";

/** Exported for tests/unit/unidades-validacion.test.ts -- same convention as modules/directores-tecnicos/application/designar-director-tecnico.ts's `designarDirectorTecnicoInput`. */
export const crearUnidadInput = z.object({
  codigo: nonEmptyString.toUpperCase(),
  nombre: nonEmptyString,
  simbolo: nonEmptyString,
  tipoMagnitud: z.enum(TIPOS_MAGNITUD),
  factorABase: positiveDecimalString,
  esBase: z.boolean().default(false),
});

/**
 * The PRE-parse shape (what a Server Action actually has on hand: raw
 * strings from `FormData`) -- deliberately NOT `z.infer<typeof
 * crearUnidadInput>`, whose `factorABase` is a `decimal.js` `Decimal` (the
 * zod schema's own transform, used by the handler). `execute()` still runs
 * the real zod parse/transform on whatever is passed in (it accepts
 * `unknown`); this type only describes the wrapper function's own public
 * signature so callers pass a `string`, not a pre-built `Decimal`.
 */
export interface CrearUnidadInput {
  codigo: string;
  nombre: string;
  simbolo: string;
  tipoMagnitud: string;
  factorABase: string;
  esBase?: boolean;
}

export const crearUnidadCommand = defineCommand({
  name: "unidades.crear",
  permiso: "unidades.crear",
  input: crearUnidadInput,
  audit: { entidad: "unidad_medida", accion: TipoAccion.CREAR },
  handler: async ({ tx, input }) => {
    if (!esBaseValido(input.esBase, input.factorABase)) {
      throw new ValidationError("Una unidad base debe tener factor 1.");
    }
    if (await existeCodigo(tx, input.codigo)) {
      throw new ValidationError("Ya existe una unidad con ese código.");
    }

    const nueva = await insertUnidad(tx, {
      codigo: input.codigo,
      nombre: input.nombre,
      simbolo: input.simbolo,
      tipoMagnitud: input.tipoMagnitud,
      factorABase: input.factorABase.toString(),
      esBase: input.esBase,
    });

    return {
      output: { id: nueva.id },
      audit: {
        entidadId: nueva.id,
        valorNuevo: {
          codigo: input.codigo,
          nombre: input.nombre,
          simbolo: input.simbolo,
          tipoMagnitud: input.tipoMagnitud,
          factorABase: input.factorABase.toString(),
          esBase: input.esBase,
        },
      },
    };
  },
});

export async function crearUnidad(input: CrearUnidadInput): Promise<{ id: string }> {
  return crearUnidadCommand.execute(input);
}
