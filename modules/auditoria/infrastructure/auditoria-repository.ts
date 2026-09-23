/**
 * Prisma-backed, READ-ONLY access to `fsj.registro_auditoria` for M03
 * (FASE 3 point 3.11). Every function here runs inside an ALREADY OPEN
 * tenant transaction (`tx`, handed in by `shared/usecase.ts`'s
 * `defineQuery`) -- nothing here opens its own transaction or imports
 * `shared/db/transaction` (same discipline as
 * `modules/usuarios/infrastructure/usuario-repository.ts`).
 *
 * This module writes NOTHING -- `fsj.registro_auditoria` is immutable by
 * DB trigger + revoked grants (migration 0003, INV-A02), and this file
 * never even attempts an insert/update/delete.
 *
 * Pagination is CURSOR-based (keyset / "seek"), not offset: the table
 * grows forever and is never purged, so `OFFSET n` degrades linearly with
 * table size. The sort key is the composite `(ocurrido_en DESC, id DESC)`
 * -- see `modules/auditoria/domain/cursor.ts`'s doc comment for why the
 * cursor must encode BOTH fields (two rows CAN share the same
 * `ocurrido_en`). One extra row (`pageSize + 1`) is fetched per query to
 * know whether there is a next page, instead of a separate `count()` --
 * a COUNT on an ever-growing table has the exact same scaling problem as
 * OFFSET pagination, so this UI never exposes a "total".
 */
import type { Prisma } from "@/generated/prisma/client";
import type { TipoAccion } from "@/generated/prisma/enums";
import { encodeCursor } from "../domain/cursor";
import type { AuditoriaCursor } from "../domain/cursor";

export interface AuditoriaFiltro {
  tenantId: string;
  entidad?: string;
  entidadId?: string;
  usuarioId?: string;
  accion?: TipoAccion;
  desde?: Date;
  hasta?: Date;
  cursor?: AuditoriaCursor;
  pageSize: number;
}

export interface AuditoriaRow {
  id: string;
  entidad: string;
  entidadId: string;
  accion: TipoAccion;
  valorAnterior: Prisma.JsonValue | null;
  valorNuevo: Prisma.JsonValue | null;
  motivo: string | null;
  autorizadoPorId: string | null;
  ocurridoEn: Date;
  usuario: { id: string; nombre: string; apellido: string };
}

export interface AuditoriaListResult {
  items: AuditoriaRow[];
  nextCursor: string | null;
}

/**
 * Builds the Prisma `where` for the filters + the keyset predicate.
 * Keyset predicate (only present once a cursor is given):
 *   (ocurrido_en < :cursorOcurridoEn)
 *   OR (ocurrido_en = :cursorOcurridoEn AND id < :cursorId)
 * combined via AND with every other filter, matching `ORDER BY
 * ocurrido_en DESC, id DESC` (strictly "before" the last row already
 * returned, in that same total order).
 */
function buildWhere(filtro: AuditoriaFiltro): Prisma.RegistroAuditoriaWhereInput {
  const conditions: Prisma.RegistroAuditoriaWhereInput[] = [{ tenantId: filtro.tenantId }];

  if (filtro.entidad) conditions.push({ entidad: filtro.entidad });
  if (filtro.entidadId) conditions.push({ entidadId: filtro.entidadId });
  if (filtro.usuarioId) conditions.push({ usuarioId: filtro.usuarioId });
  if (filtro.accion) conditions.push({ accion: filtro.accion });
  if (filtro.desde) conditions.push({ ocurridoEn: { gte: filtro.desde } });
  if (filtro.hasta) conditions.push({ ocurridoEn: { lte: filtro.hasta } });

  if (filtro.cursor) {
    const { ocurridoEn, id } = filtro.cursor;
    conditions.push({
      OR: [{ ocurridoEn: { lt: ocurridoEn } }, { AND: [{ ocurridoEn }, { id: { lt: id } }] }],
    });
  }

  return { AND: conditions };
}

export async function listRegistroAuditoria(tx: Prisma.TransactionClient, filtro: AuditoriaFiltro): Promise<AuditoriaListResult> {
  const rows = await tx.registroAuditoria.findMany({
    where: buildWhere(filtro),
    orderBy: [{ ocurridoEn: "desc" }, { id: "desc" }],
    take: filtro.pageSize + 1,
    select: {
      id: true,
      entidad: true,
      entidadId: true,
      accion: true,
      valorAnterior: true,
      valorNuevo: true,
      motivo: true,
      autorizadoPorId: true,
      ocurridoEn: true,
      usuario: { select: { id: true, nombre: true, apellido: true } },
    },
  });

  const hasMore = rows.length > filtro.pageSize;
  const items = hasMore ? rows.slice(0, filtro.pageSize) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ ocurridoEn: last.ocurridoEn, id: last.id }) : null;

  return { items, nextCursor };
}

export interface UsuarioFiltroOption {
  id: string;
  nombre: string;
  apellido: string;
}

/**
 * Author lookup for the filter dropdown, resolved through the CURRENT
 * TENANT's own `fsj.usuario` table only (so the UI never has to accept a
 * free-typed `usuarioId` from elsewhere -- it can only pick one of these).
 * `esTecnico: false` mirrors `usuario-repository.ts`'s listing convention:
 * the per-tenant SISTEMA technical user is never offered as a filter
 * option, even though its own audit rows (if any) would still match a
 * direct `usuarioId` filter if somehow supplied.
 */
export async function listUsuariosParaFiltro(tx: Prisma.TransactionClient, tenantId: string): Promise<UsuarioFiltroOption[]> {
  const rows = await tx.usuario.findMany({
    where: { tenantId, esTecnico: false },
    orderBy: [{ apellido: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, apellido: true },
  });
  return rows;
}
