/**
 * `darDeBajaUnidad` (M05, FASE 4 point 4.1, INV-G01). Sets `fecha_baja` +
 * `motivo_baja` -- the row is never deleted (INV-M03: DB trigger + no DELETE
 * grant). A unidad already given de baja cannot be given de baja again
 * (clear domain error instead of a silent no-op UPDATE).
 *
 * M3 (review finding): locks the target row FIRST (`lockUnidadParaAccion`)
 * and reads its current state with a FRESH statement only afterward -- see
 * modules/proveedores/application/dar-de-baja-proveedor.ts's doc comment
 * for the exact race this closes.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaUnidad, getUnidadParaAccion, lockUnidadParaAccion } from "../infrastructure/unidad-repository";

const darDeBajaUnidadInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type DarDeBajaUnidadInput = z.infer<typeof darDeBajaUnidadInput>;

export const darDeBajaUnidadCommand = defineCommand({
  name: "unidades.baja",
  permiso: "unidades.baja",
  input: darDeBajaUnidadInput,
  audit: { entidad: "unidad_medida", accion: "BAJA" },
  handler: async ({ tx, input }) => {
    const locked = await lockUnidadParaAccion(tx, input.id);
    if (!locked) throw new NotFoundError("Unidad de medida no encontrada.");

    const actual = await getUnidadParaAccion(tx, input.id);
    if (!actual) throw new NotFoundError("Unidad de medida no encontrada.");
    if (actual.fechaBaja !== null) {
      throw new DomainError("Esta unidad ya está dada de baja.");
    }

    const now = new Date();
    await cambiarBajaUnidad(tx, { id: input.id, fechaBaja: now, motivoBaja: input.motivo });

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        motivo: input.motivo,
        valorAnterior: { fechaBaja: null },
        valorNuevo: { fechaBaja: now.toISOString(), motivoBaja: input.motivo },
      },
    };
  },
});

export async function darDeBajaUnidad(input: DarDeBajaUnidadInput): Promise<{ id: string }> {
  return darDeBajaUnidadCommand.execute(input);
}
