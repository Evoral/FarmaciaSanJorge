/**
 * Prisma-backed access to `fsj.proveedor` for M06 (FASE 4 point 4.3). Every
 * function runs inside an ALREADY OPEN tenant transaction. The DB is
 * authoritative for the cuit FORMAT check and per-tenant cuit uniqueness
 * (migration 0007); the check-digit algorithm lives in
 * `modules/proveedores/domain/proveedor.ts` (application layer, per that
 * migration's own header comment). `motivoBaja` (migration 0027) is this
 * module's only column beyond migration 0007's original three.
 */
import type { Prisma } from "@/generated/prisma/client";

// ============================================================================
// Listing (4.3: search + soloVigentes + pagination)
// ============================================================================

export interface ListProveedoresFilter {
  tenantId: string;
  search?: string;
  soloVigentes?: boolean;
  page: number;
  pageSize: number;
}

export interface ProveedorListItem {
  id: string;
  razonSocial: string;
  cuit: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export interface ListProveedoresResult {
  items: ProveedorListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function buildWhere(filter: ListProveedoresFilter): Prisma.ProveedorWhereInput {
  const where: Prisma.ProveedorWhereInput = { tenantId: filter.tenantId };

  if (filter.search && filter.search.trim().length > 0) {
    const term = filter.search.trim();
    where.OR = [{ razonSocial: { contains: term, mode: "insensitive" } }, { cuit: { contains: term } }];
  }
  if (filter.soloVigentes === true) where.fechaBaja = null;
  else if (filter.soloVigentes === false) where.fechaBaja = { not: null };

  return where;
}

export async function listProveedores(tx: Prisma.TransactionClient, filter: ListProveedoresFilter): Promise<ListProveedoresResult> {
  const where = buildWhere(filter);
  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows] = await Promise.all([
    tx.proveedor.count({ where }),
    tx.proveedor.findMany({
      where,
      orderBy: [{ razonSocial: "asc" }],
      skip,
      take: filter.pageSize,
      select: { id: true, razonSocial: true, cuit: true, fechaBaja: true, motivoBaja: true },
    }),
  ]);

  return { items: rows, total, page: filter.page, pageSize: filter.pageSize };
}

// ============================================================================
// Read for action handlers
// ============================================================================

export interface ProveedorParaAccion {
  id: string;
  razonSocial: string;
  cuit: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export async function getProveedorParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<ProveedorParaAccion | null> {
  return tx.proveedor.findUnique({
    where: { id, tenantId },
    select: { id: true, razonSocial: true, cuit: true, fechaBaja: true, motivoBaja: true },
  });
}

/**
 * M3 (review finding): locks the target proveedor row (`SELECT ... FOR
 * UPDATE`) BEFORE any caller reads its current state -- same discipline as
 * `modules/usuarios/infrastructure/admin-guard.ts`'s header comment
 * ("lock rows in one ordered statement, then decide from a FRESH read").
 * Every editar/baja/reactivar command in this module calls this FIRST,
 * then re-reads via `getProveedorParaAccion` -- a FRESH statement, not the
 * locked snapshot's own columns -- so two concurrent bajas (or a baja
 * racing an edit) serialize instead of both reading stale "not yet given
 * de baja" state and both proceeding. Returns `false` when no row matches
 * (id not found, or not visible to this tenant) -- callers still do their
 * own NotFoundError from the subsequent read.
 */
export async function lockProveedorParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.proveedor WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

/** `true` if some OTHER proveedor in the SAME tenant already has this cuit (unique per tenant regardless of baja -- the DB's own unique index has no partial WHERE, unlike droga/medico). */
export async function existeCuit(tx: Prisma.TransactionClient, tenantId: string, cuit: string, excludeId?: string): Promise<boolean> {
  const row = await tx.proveedor.findFirst({
    where: { tenantId, cuit, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

// ============================================================================
// Writes
// ============================================================================

export interface NuevoProveedorInput {
  tenantId: string;
  razonSocial: string;
  cuit: string;
}

export async function insertProveedor(tx: Prisma.TransactionClient, input: NuevoProveedorInput): Promise<{ id: string }> {
  return tx.proveedor.create({
    data: { tenantId: input.tenantId, razonSocial: input.razonSocial, cuit: input.cuit },
    select: { id: true },
  });
}

export interface EditarProveedorInput {
  id: string;
  razonSocial: string;
  cuit: string;
}

export interface EditarProveedorVersion {
  razonSocial: string;
  cuit: string;
}

export async function updateProveedorDatos(tx: Prisma.TransactionClient, tenantId: string, input: EditarProveedorInput, version: EditarProveedorVersion): Promise<boolean> {
  const result = await tx.proveedor.updateMany({
    where: { id: input.id, tenantId, razonSocial: version.razonSocial, cuit: version.cuit },
    data: { razonSocial: input.razonSocial, cuit: input.cuit },
  });
  return result.count === 1;
}

export interface CambiarBajaProveedorInput {
  tenantId: string;
  id: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export async function cambiarBajaProveedor(tx: Prisma.TransactionClient, input: CambiarBajaProveedorInput): Promise<void> {
  await tx.proveedor.update({
    where: { id: input.id, tenantId: input.tenantId },
    data: { fechaBaja: input.fechaBaja, motivoBaja: input.motivoBaja },
  });
}
