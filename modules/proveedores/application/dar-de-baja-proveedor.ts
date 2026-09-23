/**
 * `darDeBajaProveedor` (M06, FASE 4 point 4.3). Sets `fecha_baja` +
 * `motivo_baja` (migration 0027) -- never deleted (generic forbid_delete
 * trigger, migration 0007). A proveedor already de baja cannot be given de
 * baja again.
 *
 * M3 (review finding): locks the target row FIRST (`lockProveedorParaAccion`)
 * and reads its current state with a FRESH statement only afterward --
 * previously this read was unlocked, so two concurrent bajas on the same
 * proveedor could both read `fechaBaja === null`, both pass the check
 * below, and both write -- the second write's audit row would then record
 * a false "before: vigente" state for what was actually already a baja.
 * The lock makes the second transaction wait for the first to commit, then
 * its fresh read sees the real (now baja) state and correctly rejects.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaProveedor, getProveedorParaAccion, lockProveedorParaAccion } from "../infrastructure/proveedor-repository";

const darDeBajaProveedorInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type DarDeBajaProveedorInput = z.infer<typeof darDeBajaProveedorInput>;

export const darDeBajaProveedorCommand = defineCommand({
  name: "proveedores.baja",
  permiso: "proveedores.gestionar",
  input: darDeBajaProveedorInput,
  audit: { entidad: "proveedor", accion: "BAJA" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockProveedorParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Proveedor no encontrado.");

    const actual = await getProveedorParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Proveedor no encontrado.");
    if (actual.fechaBaja !== null) {
      throw new DomainError("Este proveedor ya está dado de baja.");
    }

    const now = new Date();
    await cambiarBajaProveedor(tx, { tenantId: session.tenantId, id: input.id, fechaBaja: now, motivoBaja: input.motivo });

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

export async function darDeBajaProveedor(input: DarDeBajaProveedorInput): Promise<{ id: string }> {
  return darDeBajaProveedorCommand.execute(input);
}
