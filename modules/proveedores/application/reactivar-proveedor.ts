/**
 * `reactivarProveedor` (M06, FASE 4 point 4.3, INV-G01). Mirror of
 * `dar-de-baja-proveedor.ts`: clears `fecha_baja`/`motivo_baja`. Same M3
 * lock-then-fresh-read fix -- see that file's doc comment for the race this
 * closes.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarBajaProveedor, getProveedorParaAccion, lockProveedorParaAccion } from "../infrastructure/proveedor-repository";

const reactivarProveedorInput = z.object({
  id: uuid,
  motivo: nonEmptyString,
});

export type ReactivarProveedorInput = z.infer<typeof reactivarProveedorInput>;

export const reactivarProveedorCommand = defineCommand({
  name: "proveedores.reactivar",
  permiso: "proveedores.gestionar",
  input: reactivarProveedorInput,
  audit: { entidad: "proveedor", accion: "REACTIVAR" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockProveedorParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Proveedor no encontrado.");

    const actual = await getProveedorParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Proveedor no encontrado.");
    if (actual.fechaBaja === null) {
      throw new DomainError("Este proveedor no está dado de baja.");
    }

    await cambiarBajaProveedor(tx, { tenantId: session.tenantId, id: input.id, fechaBaja: null, motivoBaja: null });

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

export async function reactivarProveedor(input: ReactivarProveedorInput): Promise<{ id: string }> {
  return reactivarProveedorCommand.execute(input);
}
