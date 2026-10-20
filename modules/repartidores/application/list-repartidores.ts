/**
 * `listRepartidores`: the catalog screen (`/catalogos/repartidores`), paginated. Text search over nombre / apellido /
 * telefono and an `activo` filter. `repartidores.gestionar`.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listRepartidores as listRepartidoresRepo } from "../infrastructure/repartidor-repository";
import type { ListRepartidoresResult } from "../infrastructure/repartidor-repository";

/** Exported for tests/unit/repartidores-validacion.test.ts. */
export const listRepartidoresInput = z
  .object({
    search: z.string().trim().max(100).optional(),
    /** `true` = only active, `false` = only inactive, omitted = both. */
    activo: z.boolean().optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListRepartidoresInput = z.input<typeof listRepartidoresInput>;

export const listRepartidoresQuery = defineQuery({
  name: "repartidores.listar",
  permiso: "repartidores.gestionar",
  input: listRepartidoresInput,
  handler: async ({ tx, session, input }) =>
    listRepartidoresRepo(tx, { tenantId: session.tenantId, search: input.search, activo: input.activo, page: input.page, pageSize: input.pageSize }),
});

export async function listRepartidores(input: ListRepartidoresInput = {}): Promise<ListRepartidoresResult> {
  return listRepartidoresQuery.execute(input);
}
