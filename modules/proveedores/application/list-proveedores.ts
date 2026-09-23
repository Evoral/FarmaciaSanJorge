/**
 * `listProveedores` (M06, FASE 4 point 4.3). Read-only, gated on the same
 * single `proveedores.gestionar` permiso as every other action in this
 * module (plan §7: "proveedores.*").
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listProveedores as listProveedoresRepo } from "../infrastructure/proveedor-repository";
import type { ListProveedoresResult } from "../infrastructure/proveedor-repository";

const listProveedoresInput = z.object({
  search: z.string().trim().optional(),
  soloVigentes: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListProveedoresInput = z.infer<typeof listProveedoresInput>;

export const listProveedoresQuery = defineQuery({
  name: "proveedores.listar",
  permiso: "proveedores.gestionar",
  input: listProveedoresInput,
  handler: async ({ tx, session, input }) => {
    return listProveedoresRepo(tx, {
      tenantId: session.tenantId,
      search: input.search,
      soloVigentes: input.soloVigentes,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listProveedores(input: ListProveedoresInput): Promise<ListProveedoresResult> {
  return listProveedoresQuery.execute(input);
}
