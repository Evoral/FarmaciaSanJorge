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

const listUsuarioAuditoriaInput = z.object({
  usuarioId: uuid,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListUsuarioAuditoriaInput = z.infer<typeof listUsuarioAuditoriaInput>;

export interface AuditoriaUsuarioRow {
  id: string;
  accion: string;
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
}

export const listUsuarioAuditoriaQuery = defineQuery({
  name: "usuarios.auditoria.ver",
  permiso: "usuarios.auditoria.ver",
  input: listUsuarioAuditoriaInput,
  handler: async ({ tx, input }): Promise<ListUsuarioAuditoriaResult> => {
    const where = { entidad: "usuario", entidadId: input.usuarioId } as const;
    const skip = (input.page - 1) * input.pageSize;

    const [total, rows] = await Promise.all([
      tx.registroAuditoria.count({ where }),
      tx.registroAuditoria.findMany({
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
      }),
    ]);

    return { items: rows, total, page: input.page, pageSize: input.pageSize };
  },
});

export async function listUsuarioAuditoria(input: ListUsuarioAuditoriaInput): Promise<ListUsuarioAuditoriaResult> {
  return listUsuarioAuditoriaQuery.execute(input);
}
