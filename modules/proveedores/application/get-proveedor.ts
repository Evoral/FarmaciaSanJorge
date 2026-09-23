/** `getProveedor` (M06, FASE 4 point 4.3): single-row read for `/catalogos/proveedores/[id]`. */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getProveedorParaAccion } from "../infrastructure/proveedor-repository";
import type { ProveedorParaAccion } from "../infrastructure/proveedor-repository";

const getProveedorInput = z.object({ id: uuid });

export const getProveedorQuery = defineQuery({
  name: "proveedores.ver",
  permiso: "proveedores.gestionar",
  input: getProveedorInput,
  handler: async ({ tx, session, input }) => getProveedorParaAccion(tx, session.tenantId, input.id),
});

export async function getProveedor(id: string): Promise<ProveedorParaAccion | null> {
  return getProveedorQuery.execute({ id });
}
