/**
 * `listUsuarios` (M03, FASE 3 point 3.1). Read-only: search by
 * nombre/apellido/email/dni, filter by estado/rol, offset pagination
 * (plan §16 3.1 allows either cursor or offset -- offset is the simpler
 * correct choice for an admin table with a bounded row count per tenant).
 * The technical user (es_tecnico) is always excluded -- see
 * modules/usuarios/infrastructure/usuario-repository.ts's module doc
 * comment.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { ROLES_ASIGNABLES } from "../domain/roles";
import { listUsuarios as listUsuariosRepo } from "../infrastructure/usuario-repository";
import type { ListUsuariosResult } from "../infrastructure/usuario-repository";

const ESTADOS = ["PENDIENTE_ACTIVACION", "ACTIVO", "SUSPENDIDO", "BAJA"] as const;

const listUsuariosInput = z.object({
  search: z.string().trim().max(200).optional(),
  estado: z.enum(ESTADOS).optional(),
  rolCodigo: z.enum(ROLES_ASIGNABLES).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListUsuariosInput = z.infer<typeof listUsuariosInput>;

export const listUsuariosQuery = defineQuery({
  name: "usuarios.listar",
  permiso: "usuarios.listar",
  input: listUsuariosInput,
  handler: async ({ tx, session, input }) => {
    return listUsuariosRepo(tx, {
      tenantId: session.tenantId,
      search: input.search,
      estado: input.estado,
      rolCodigo: input.rolCodigo,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listUsuarios(input: ListUsuariosInput): Promise<ListUsuariosResult> {
  return listUsuariosQuery.execute(input);
}
