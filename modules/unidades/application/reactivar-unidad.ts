/**
 * `reactivarUnidad` (M05, FASE 4 point 4.1, INV-G01: "reactivar con motivo").
 * Plan §7's permission matrix only defines `unidades.crear/editar/baja` for
 * this module -- no dedicated `unidades.reactivar` permiso exists in the
 * seed (migration 0002) or in `modules/auth/domain/permisos.ts`. Reactivar is
 * the mirror-image state transition of baja (clears `fecha_baja`/`motivo_baja`
 * instead of setting them), so this command is gated on `unidades.baja`, the
 * matrix's own permiso for the baja/reactivación lifecycle of this table --
 * same precedent as `modules/directores-tecnicos/application/list-designaciones.ts`
 * reusing `dt.designar` for a read action the matrix does not name separately.
 * Same M3 lock-then-fresh-read fix as dar-de-baja-unidad.ts -- see that
 * file's doc comment.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaUnidad, getUnidadParaAccion, lockUnidadParaAccion } from "../infrastructure/unidad-repository";

const reactivarUnidadInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type ReactivarUnidadInput = z.infer<typeof reactivarUnidadInput>;

export const reactivarUnidadCommand = defineCommand({
  name: "unidades.reactivar",
  permiso: "unidades.baja",
  input: reactivarUnidadInput,
  audit: { entidad: "unidad_medida", accion: "REACTIVAR" },
  handler: async ({ tx, input }) => {
    const locked = await lockUnidadParaAccion(tx, input.id);
    if (!locked) throw new NotFoundError("Unidad de medida no encontrada.");

    const actual = await getUnidadParaAccion(tx, input.id);
    if (!actual) throw new NotFoundError("Unidad de medida no encontrada.");
    if (actual.fechaBaja === null) {
      throw new DomainError("Esta unidad no está dada de baja.");
    }

    await cambiarBajaUnidad(tx, { id: input.id, fechaBaja: null, motivoBaja: null });

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        motivo: input.motivo,
        valorAnterior: { fechaBaja: actual.fechaBaja.toISOString(), motivoBaja: actual.motivoBaja },
        valorNuevo: { fechaBaja: null, motivoBaja: null },
      },
    };
  },
});

export async function reactivarUnidad(input: ReactivarUnidadInput): Promise<{ id: string }> {
  return reactivarUnidadCommand.execute(input);
}
