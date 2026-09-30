/**
 * `listUsuarioAuditoria` (M03, FASE 3 point 3.7 -- per-user history tab).
 * Read-only query over `fsj.registro_auditoria` filtered to
 * `entidad = 'usuario'` and `entidad_id = usuarioId` (M01's audit trail is
 * the source of truth for "who did what, when" -- `usuario_estado_historial`,
 * exposed separately, only covers estado transitions specifically).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import type { TipoAccion } from "@/generated/prisma/enums";

const listUsuarioAuditoriaInput = z.object({
  usuarioId: uuid,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListUsuarioAuditoriaInput = z.infer<typeof listUsuarioAuditoriaInput>;

export interface AuditoriaUsuarioRow {
  id: string;
  accion: TipoAccion;
  valorAnterior: unknown;
  valorNuevo: unknown;
  motivo: string | null;
  ocurridoEn: Date;
  usuario: { id: string; nombre: string; apellido: string };
}

export interface ListUsuarioAuditoriaResult {
  items: AuditoriaUsuarioRow[];
  total: number;
  page: number;
  pageSize: number;
  /** The tenant's time zone -- dates must be formatted in pharmacy time, not the server's (UTC on Vercel). */
  zonaHoraria: string;
}

export const listUsuarioAuditoriaQuery = defineQuery({
  name: "usuarios.auditoria.ver",
  permiso: "usuarios.auditoria.ver",
  input: listUsuarioAuditoriaInput,
  handler: async ({ tx, session, input }): Promise<ListUsuarioAuditoriaResult> => {
    const where = { entidad: "usuario", entidadId: input.usuarioId } as const;
    const skip = (input.page - 1) * input.pageSize;

    const total = await tx.registroAuditoria.count({ where });
    const rows = await tx.registroAuditoria.findMany({
      where,
      orderBy: { ocurridoEn: "desc" },
      skip,
      take: input.pageSize,
      select: {
        id: true,
        accion: true,
        valorAnterior: true,
        valorNuevo: true,
        motivo: true,
        ocurridoEn: true,
        usuario: { select: { id: true, nombre: true, apellido: true } },
      },
    });

    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: session.tenantId }, select: { zonaHoraria: true } });

    return { items: rows, total, page: input.page, pageSize: input.pageSize, zonaHoraria: tenant.zonaHoraria };
  },
});

export async function listUsuarioAuditoria(input: ListUsuarioAuditoriaInput): Promise<ListUsuarioAuditoriaResult> {
  return listUsuarioAuditoriaQuery.execute(input);
}
