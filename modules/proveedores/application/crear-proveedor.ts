/**
 * `crearProveedor` (M06, FASE 4 point 4.3). FAR/DT/ADM share ONE permiso,
 * `proveedores.gestionar` (plan §7: "proveedores.*"), for every action in
 * this module -- migration 0002's seed grants it identically to crear,
 * editar, baja and reactivar, so there is nothing to differentiate by
 * splitting it further.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ValidationError } from "@/shared/errors";
import { nonEmptyString } from "@/shared/validation";
import { cuitString } from "../domain/proveedor";
import { existeCuit, insertProveedor } from "../infrastructure/proveedor-repository";

const crearProveedorInput = z.object({
  razonSocial: nonEmptyString,
  cuit: cuitString,
});

export type CrearProveedorInput = z.infer<typeof crearProveedorInput>;

export const crearProveedorCommand = defineCommand({
  name: "proveedores.crear",
  permiso: "proveedores.gestionar",
  input: crearProveedorInput,
  audit: { entidad: "proveedor", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    if (await existeCuit(tx, session.tenantId, input.cuit)) {
      throw new ValidationError("Ya existe un proveedor con ese CUIT.");
    }

    const nuevo = await insertProveedor(tx, { tenantId: session.tenantId, razonSocial: input.razonSocial, cuit: input.cuit });

    return {
      output: { id: nuevo.id },
      audit: { entidadId: nuevo.id, valorNuevo: { razonSocial: input.razonSocial, cuit: input.cuit } },
    };
  },
});

export async function crearProveedor(input: CrearProveedorInput): Promise<{ id: string }> {
  return crearProveedorCommand.execute(input);
}
