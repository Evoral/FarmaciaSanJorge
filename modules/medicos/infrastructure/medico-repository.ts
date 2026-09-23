/**
 * Prisma-backed access to `fsj.medico` for M06 (FASE 4 point 4.4). Every
 * function runs inside an ALREADY OPEN tenant transaction. The DB is
 * authoritative for per-tenant matrícula uniqueness AMONG VIGENTE rows
 * (migration 0007's partial unique index); matrícula normalization
 * (trim/collapse-whitespace/uppercase) is applied before it ever reaches
 * here (modules/medicos/domain/medico.ts). `motivoBaja` (migration 0029) is
 * this module's only column beyond migration 0007's original set.
 */
import type { Prisma } from "@/generated/prisma/client";

// ============================================================================
// Listing (4.4: search by apellido/matrícula + soloVigentes + pagination)
// ============================================================================

export interface ListMedicosFilter {
  tenantId: string;
  search?: string;
  soloVigentes?: boolean;
  page: number;
  pageSize: number;
}

export interface MedicoListItem {
  id: string;
  nombre: string;
  apellido: string;
  matricula: string;
  especialidad: string | null;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export interface ListMedicosResult {
  items: MedicoListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function buildWhere(filter: ListMedicosFilter): Prisma.MedicoWhereInput {
  const where: Prisma.MedicoWhereInput = { tenantId: filter.tenantId };

  if (filter.search && filter.search.trim().length > 0) {
    const term = filter.search.trim();
    where.OR = [{ apellido: { contains: term, mode: "insensitive" } }, { matricula: { contains: term, mode: "insensitive" } }];
  }
  if (filter.soloVigentes === true) where.fechaBaja = null;
  else if (filter.soloVigentes === false) where.fechaBaja = { not: null };

  return where;
}

export async function listMedicos(tx: Prisma.TransactionClient, filter: ListMedicosFilter): Promise<ListMedicosResult> {
  const where = buildWhere(filter);
  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows] = await Promise.all([
    tx.medico.count({ where }),
    tx.medico.findMany({
      where,
      orderBy: [{ apellido: "asc" }, { nombre: "asc" }],
      skip,
      take: filter.pageSize,
      select: { id: true, nombre: true, apellido: true, matricula: true, especialidad: true, fechaBaja: true, motivoBaja: true },
    }),
  ]);

  return { items: rows, total, page: filter.page, pageSize: filter.pageSize };
}

// ============================================================================
// Read for action handlers
// ============================================================================

export interface MedicoParaAccion {
  id: string;
  nombre: string;
  apellido: string;
  matricula: string;
  especialidad: string | null;
  telefono: string | null;
  direccionRegistrada: string | null;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

const SELECT_PARA_ACCION = {
  id: true,
  nombre: true,
  apellido: true,
  matricula: true,
  especialidad: true,
  telefono: true,
  direccionRegistrada: true,
  fechaBaja: true,
  motivoBaja: true,
} as const;

export async function getMedicoParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<MedicoParaAccion | null> {
  return tx.medico.findUnique({ where: { id, tenantId }, select: SELECT_PARA_ACCION });
}

/**
 * Locks the target médico row (`SELECT ... FOR UPDATE`) BEFORE any caller
 * reads its current state -- same discipline as
 * modules/proveedores/infrastructure/proveedor-repository.ts's
 * `lockProveedorParaAccion` (M3 review finding, applied here from the
 * start per this task's binding rules). Every editar/baja/reactivar
 * command in this module calls this FIRST, then re-reads via a FRESH
 * statement (`getMedicoParaAccion`), so two concurrent bajas (or a baja
 * racing an edit) on the SAME médico serialize instead of both racing an
 * unlocked read. Returns `false` when no row matches.
 */
export async function lockMedicoParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.medico WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

/** `true` if some OTHER médico VIGENTE in the SAME tenant already has this (normalized) matrícula -- mirrors migration 0007's partial unique index (`WHERE fecha_baja IS NULL`). */
export async function existeMatriculaVigente(tx: Prisma.TransactionClient, tenantId: string, matricula: string, excludeId?: string): Promise<boolean> {
  const row = await tx.medico.findFirst({
    where: { tenantId, matricula, fechaBaja: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

// ============================================================================
// Writes
// ============================================================================

export interface NuevoMedicoInput {
  tenantId: string;
  nombre: string;
  apellido: string;
  matricula: string;
  especialidad?: string | null;
  telefono?: string | null;
  direccionRegistrada?: string | null;
}

export async function insertMedico(tx: Prisma.TransactionClient, input: NuevoMedicoInput): Promise<{ id: string }> {
  return tx.medico.create({
    data: {
      tenantId: input.tenantId,
      nombre: input.nombre,
      apellido: input.apellido,
      matricula: input.matricula,
      especialidad: input.especialidad ?? null,
      telefono: input.telefono ?? null,
      direccionRegistrada: input.direccionRegistrada ?? null,
    },
    select: { id: true },
  });
}

export interface EditarMedicoInput {
  id: string;
  nombre: string;
  apellido: string;
  matricula: string;
  especialidad: string | null;
  telefono: string | null;
  direccionRegistrada: string | null;
}

export interface EditarMedicoVersion {
  nombre: string;
  apellido: string;
  matricula: string;
  especialidad: string | null;
  telefono: string | null;
  direccionRegistrada: string | null;
}

export async function updateMedicoDatos(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: EditarMedicoInput,
  version: EditarMedicoVersion,
): Promise<boolean> {
  const result = await tx.medico.updateMany({
    where: {
      id: input.id,
      tenantId,
      nombre: version.nombre,
      apellido: version.apellido,
      matricula: version.matricula,
      especialidad: version.especialidad,
      telefono: version.telefono,
      direccionRegistrada: version.direccionRegistrada,
    },
    data: {
      nombre: input.nombre,
      apellido: input.apellido,
      matricula: input.matricula,
      especialidad: input.especialidad,
      telefono: input.telefono,
      direccionRegistrada: input.direccionRegistrada,
    },
  });
  return result.count === 1;
}

export interface CambiarBajaMedicoInput {
  tenantId: string;
  id: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export async function cambiarBajaMedico(tx: Prisma.TransactionClient, input: CambiarBajaMedicoInput): Promise<void> {
  await tx.medico.update({
    where: { id: input.id, tenantId: input.tenantId },
    data: { fechaBaja: input.fechaBaja, motivoBaja: input.motivoBaja },
  });
}
