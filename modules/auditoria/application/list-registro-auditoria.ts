/**
 * `listRegistroAuditoria` (M03, FASE 3 point 3.11 -- tenant-scoped audit
 * log viewer). READ-ONLY: no write path exists anywhere in this module.
 * Gated on `auditoria.ver` (migration 0002's seed: ADMINISTRADOR and
 * DIRECTOR_TECNICO only -- verified directly against the seed SQL, see
 * this task's final report). Distinct from `usuarios.auditoria.ver`
 * (`modules/usuarios/application/list-usuario-auditoria.ts`), which is a
 * narrower, per-usuario tab gated on a different permiso -- this query is
 * the general, filterable, tenant-wide log.
 *
 * Pagination is cursor-based (keyset over `(ocurrido_en DESC, id DESC)`),
 * never offset -- see `modules/auditoria/infrastructure/auditoria-repository.ts`'s
 * doc comment for why.
 */
import { z } from "zod";
import { defineQuery, TipoAccion } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { decodeCursor } from "../domain/cursor";
import { listRegistroAuditoria as listRegistroAuditoriaRepo } from "../infrastructure/auditoria-repository";
import type { AuditoriaListResult } from "../infrastructure/auditoria-repository";

const listRegistroAuditoriaInput = z
  .object({
    entidad: z.string().trim().min(1).max(100).optional(),
    entidadId: uuid.optional(),
    usuarioId: uuid.optional(),
    accion: z.nativeEnum(TipoAccion).optional(),
    desde: z.coerce.date().optional(),
    hasta: z.coerce.date().optional(),
    cursor: z.string().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .refine((value) => !value.desde || !value.hasta || value.desde <= value.hasta, {
    message: "'desde' must not be after 'hasta'.",
    path: ["desde"],
  });

export type ListRegistroAuditoriaInput = z.infer<typeof listRegistroAuditoriaInput>;
/** Pre-coercion wire shape (`desde`/`hasta` as the raw strings a GET query string or a Server Action hands in) -- `z.infer`/`z.output` above already reflects the POST-`z.coerce.date()` shape, which is what a caller receives back from `execute()`, not what it may validly send in. */
export type ListRegistroAuditoriaWireInput = z.input<typeof listRegistroAuditoriaInput>;

export const listRegistroAuditoriaQuery = defineQuery({
  name: "auditoria.ver",
  permiso: "auditoria.ver",
  input: listRegistroAuditoriaInput,
  handler: async ({ tx, session, input }): Promise<AuditoriaListResult> => {
    return listRegistroAuditoriaRepo(tx, {
      tenantId: session.tenantId,
      entidad: input.entidad,
      entidadId: input.entidadId,
      usuarioId: input.usuarioId,
      accion: input.accion,
      desde: input.desde,
      hasta: input.hasta,
      cursor: input.cursor ? decodeCursor(input.cursor) : undefined,
      pageSize: input.pageSize,
    });
  },
});

export async function listRegistroAuditoria(input: ListRegistroAuditoriaWireInput): Promise<AuditoriaListResult> {
  return listRegistroAuditoriaQuery.execute(input);
}
