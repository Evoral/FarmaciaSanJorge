/**
 * `listProveedoresOpciones` -- every vigente proveedor (id + razón social)
 * for a `<select>` picker, e.g. `/stock/ingresar`. Same reasoning as
 * modules/drogas/application/list-drogas-opciones.ts: a picker needs the
 * whole vigente catalog, which the paginated `listProveedores` (`pageSize`
 * capped at 100) can't return without silently truncating it. Same
 * `proveedores.gestionar` permiso as every other action in this module.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listProveedoresOpciones as listProveedoresOpcionesRepo } from "../infrastructure/proveedor-repository";
import type { ProveedorOpcion } from "../infrastructure/proveedor-repository";

export type { ProveedorOpcion };

export const listProveedoresOpcionesQuery = defineQuery({
  name: "proveedores.opciones",
  permiso: "proveedores.gestionar",
  input: z.object({}),
  handler: async ({ tx, session }) => listProveedoresOpcionesRepo(tx, session.tenantId),
});

export async function listProveedoresOpciones(): Promise<ProveedorOpcion[]> {
  return listProveedoresOpcionesQuery.execute({});
}
