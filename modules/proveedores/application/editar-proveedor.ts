/**
 * `editarProveedor` (M06, FASE 4 point 4.3). Optimistic concurrency: same
 * compare-and-swap shape as modules/usuarios/application/editar-usuario.ts,
 * PLUS (M3 review finding) a row lock taken BEFORE the state is read: the
 * handler calls `lockProveedorParaAccion` first, then re-reads the row with
 * a FRESH statement (`getProveedorParaAccion`) -- so a concurrent baja/
 * reactivación/edit on the SAME proveedor serializes against this one
 * instead of both racing an unlocked read. Because the fresh read happens
 * only after the lock is held, it also now correctly detects "this
 * proveedor was given de baja by someone else while this edit was in
 * flight" (see the check right after the lock) -- previously the
 * compare-and-swap never looked at fechaBaja/motivoBaja at all, so an edit
 * and a baja could commit without ever noticing each other.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cuitString } from "../domain/proveedor";
import { existeCuit, getProveedorParaAccion, lockProveedorParaAccion, updateProveedorDatos } from "../infrastructure/proveedor-repository";

const editarProveedorInput = z.object({
  id: uuid,
  razonSocial: nonEmptyString,
  cuit: cuitString,
  version: z.object({
    razonSocial: z.string(),
    cuit: z.string(),
  }),
});

export type EditarProveedorInput = z.infer<typeof editarProveedorInput>;

export const CONCURRENCY_MESSAGE = "El proveedor fue modificado por otra persona, recargá.";

export const editarProveedorCommand = defineCommand({
  name: "proveedores.editar",
  permiso: "proveedores.gestionar",
  input: editarProveedorInput,
  audit: { entidad: "proveedor", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockProveedorParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Proveedor no encontrado.");

    const actual = await getProveedorParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Proveedor no encontrado.");

    // M3: a proveedor given de baja concurrently (after this edit's form
    // was loaded, before it was submitted) is a conflict -- the DB row is
    // no longer what the form was edited against.
    if (actual.fechaBaja !== null) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    if (actual.razonSocial !== input.version.razonSocial || actual.cuit !== input.version.cuit) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    if (input.cuit !== actual.cuit && (await existeCuit(tx, session.tenantId, input.cuit, input.id))) {
      throw new ValidationError("Ya existe un proveedor con ese CUIT.");
    }

    const updated = await updateProveedorDatos(
      tx,
      session.tenantId,
      { id: input.id, razonSocial: input.razonSocial, cuit: input.cuit },
      { razonSocial: actual.razonSocial, cuit: actual.cuit },
    );
    if (!updated) throw new ConflictError(CONCURRENCY_MESSAGE);

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { razonSocial: actual.razonSocial, cuit: actual.cuit },
        valorNuevo: { razonSocial: input.razonSocial, cuit: input.cuit },
      },
    };
  },
});

export async function editarProveedor(input: EditarProveedorInput): Promise<{ id: string }> {
  return editarProveedorCommand.execute(input);
}
