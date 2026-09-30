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
import { rangoDeJornadas } from "@/shared/time/jornada";
import { getZonaHorariaTenant, listRegistroAuditoria as listRegistroAuditoriaRepo } from "../infrastructure/auditoria-repository";
import type { AuditoriaListResult } from "../infrastructure/auditoria-repository";

/** `zonaHoraria`: the tenant's time zone, so the page formats dates in pharmacy time, not the server's (UTC on Vercel). */
export type ListRegistroAuditoriaResult = AuditoriaListResult & { zonaHoraria: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha en formato AAAA-MM-DD.");

const listRegistroAuditoriaInput = z
  .object({
    entidad: z.string().trim().min(1).max(100).optional(),
    entidadId: uuid.optional(),
    usuarioId: uuid.optional(),
    accion: z.nativeEnum(TipoAccion).optional(),
    /** Calendar days (YYYY-MM-DD) in the tenant's time zone, both inclusive. */
    desde: isoDate.optional(),
    hasta: isoDate.optional(),
    cursor: z.string().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .refine((value) => !value.desde || !value.hasta || value.desde <= value.hasta, {
    message: "La fecha desde no puede ser posterior a la fecha hasta.",
    path: ["desde"],
  });

export type ListRegistroAuditoriaInput = z.infer<typeof listRegistroAuditoriaInput>;
/** Pre-parse wire shape (`pageSize` optional, defaulted by zod) -- what a caller may validly send in, as opposed to `z.infer`'s post-parse shape. */
export type ListRegistroAuditoriaWireInput = z.input<typeof listRegistroAuditoriaInput>;

export const listRegistroAuditoriaQuery = defineQuery({
  name: "auditoria.ver",
  permiso: "auditoria.ver",
  input: listRegistroAuditoriaInput,
  handler: async ({ tx, session, input }): Promise<ListRegistroAuditoriaResult> => {
    const zonaHoraria = await getZonaHorariaTenant(tx, session.tenantId);
    const rango = rangoDeJornadas(input.desde, input.hasta, zonaHoraria);
    const result = await listRegistroAuditoriaRepo(tx, {
      tenantId: session.tenantId,
      entidad: input.entidad,
      entidadId: input.entidadId,
      usuarioId: input.usuarioId,
      accion: input.accion,
      desde: rango.desde,
      hastaExclusivo: rango.hastaExclusivo,
      cursor: input.cursor ? decodeCursor(input.cursor) : undefined,
      pageSize: input.pageSize,
    });
    return { ...result, zonaHoraria };
  },
});

export async function listRegistroAuditoria(input: ListRegistroAuditoriaWireInput): Promise<ListRegistroAuditoriaResult> {
  return listRegistroAuditoriaQuery.execute(input);
}
