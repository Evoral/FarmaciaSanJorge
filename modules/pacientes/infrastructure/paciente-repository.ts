/**
 * Prisma-backed access to `fsj.paciente` for M06 (FASE 4 point 4.5).
 * HEALTH-ADJACENT DATA (DP-24) -- every function runs inside an ALREADY
 * OPEN tenant transaction (RLS-scoped) and NONE of them ever pass a
 * paciente field to a logger (see shared/logging/logger.ts's redact list
 * for the defense-in-depth net). The DB is authoritative for cuil/dni
 * FORMAT (migration 0029) and cuil uniqueness (migration 0007, survives
 * baja -- no partial `WHERE fecha_baja IS NULL`, unlike medico.matricula);
 * the CUIL check-digit algorithm lives in
 * `modules/pacientes/domain/paciente.ts` (application layer).
 */
import type { Prisma } from "@/generated/prisma/client";

// ============================================================================
// Listing (4.5: search by apellido/dni + soloVigentes + pagination). The
// UI layer (app/(app)/catalogos/pacientes/**) is responsible for NEVER
// putting the `search` term in a URL/query string (DP-24) -- this function
// itself is agnostic to how the caller obtained `search`.
// ============================================================================

export interface ListPacientesFilter {
  tenantId: string;
  search?: string;
  soloVigentes?: boolean;
  page: number;
  pageSize: number;
}

export interface PacienteListItem {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export interface ListPacientesResult {
  items: PacienteListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function buildWhere(filter: ListPacientesFilter): Prisma.PacienteWhereInput {
  const where: Prisma.PacienteWhereInput = { tenantId: filter.tenantId };

  if (filter.search && filter.search.trim().length > 0) {
    const term = filter.search.trim();
    where.OR = [{ apellido: { contains: term, mode: "insensitive" } }, { dni: { contains: term } }, { cuil: { contains: term } }];
  }
  if (filter.soloVigentes === true) where.fechaBaja = null;
  else if (filter.soloVigentes === false) where.fechaBaja = { not: null };

  return where;
}

export async function listPacientes(tx: Prisma.TransactionClient, filter: ListPacientesFilter): Promise<ListPacientesResult> {
  const where = buildWhere(filter);
  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows] = await Promise.all([
    tx.paciente.count({ where }),
    tx.paciente.findMany({
      where,
      orderBy: [{ apellido: "asc" }, { nombre: "asc" }],
      skip,
      take: filter.pageSize,
      select: { id: true, nombre: true, apellido: true, dni: true, fechaBaja: true, motivoBaja: true },
    }),
  ]);

  return { items: rows, total, page: filter.page, pageSize: filter.pageSize };
}

// ============================================================================
// Read for action handlers
// ============================================================================

export interface PacienteParaAccion {
  id: string;
  nombre: string;
  apellido: string;
  cuil: string | null;
  dni: string | null;
  telefono: string | null;
  email: string | null;
  fechaNacimiento: Date | null;
  nroCredencial: string | null;
  sexo: string | null;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

const SELECT_PARA_ACCION = {
  id: true,
  nombre: true,
  apellido: true,
  cuil: true,
  dni: true,
  telefono: true,
  email: true,
  fechaNacimiento: true,
  nroCredencial: true,
  sexo: true,
  fechaBaja: true,
  motivoBaja: true,
} as const;

export async function getPacienteParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PacienteParaAccion | null> {
  return tx.paciente.findUnique({ where: { id, tenantId }, select: SELECT_PARA_ACCION });
}

/**
 * Locks the target paciente row (`SELECT ... FOR UPDATE`) BEFORE any caller
 * reads its current state -- same discipline as
 * modules/proveedores/infrastructure/proveedor-repository.ts's
 * `lockProveedorParaAccion` (M3 review finding, applied here from the
 * start per this task's binding rules). Returns `false` when no row
 * matches.
 */
export async function lockPacienteParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.paciente WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

/** `true` if some OTHER paciente in the SAME tenant already has this cuil -- migration 0007's `uq_paciente_cuil` has NO partial `WHERE fecha_baja IS NULL`, so this is unique regardless of baja (a cuil can never be reused by a different person even after the original paciente is given de baja). */
export async function existeCuil(tx: Prisma.TransactionClient, tenantId: string, cuil: string, excludeId?: string): Promise<boolean> {
  const row = await tx.paciente.findFirst({
    where: { tenantId, cuil, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

// ============================================================================
// Writes
// ============================================================================

export interface NuevoPacienteInput {
  tenantId: string;
  nombre: string;
  apellido: string;
  cuil: string | null;
  dni: string | null;
  telefono: string | null;
  email: string | null;
  fechaNacimiento: Date | null;
  nroCredencial: string | null;
  sexo: string | null;
}

export async function insertPaciente(tx: Prisma.TransactionClient, input: NuevoPacienteInput): Promise<{ id: string }> {
  return tx.paciente.create({
    data: {
      tenantId: input.tenantId,
      nombre: input.nombre,
      apellido: input.apellido,
      cuil: input.cuil,
      dni: input.dni,
      telefono: input.telefono,
      email: input.email,
      fechaNacimiento: input.fechaNacimiento,
      nroCredencial: input.nroCredencial,
      sexo: input.sexo,
    },
    select: { id: true },
  });
}

export interface EditarPacienteInput {
  id: string;
  nombre: string;
  apellido: string;
  cuil: string | null;
  dni: string | null;
  telefono: string | null;
  email: string | null;
  fechaNacimiento: Date | null;
  nroCredencial: string | null;
  sexo: string | null;
}

export interface EditarPacienteVersion {
  nombre: string;
  apellido: string;
  cuil: string | null;
  dni: string | null;
  telefono: string | null;
  email: string | null;
  fechaNacimiento: Date | null;
  nroCredencial: string | null;
  sexo: string | null;
}

export async function updatePacienteDatos(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: EditarPacienteInput,
  version: EditarPacienteVersion,
): Promise<boolean> {
  const result = await tx.paciente.updateMany({
    where: {
      id: input.id,
      tenantId,
      nombre: version.nombre,
      apellido: version.apellido,
      cuil: version.cuil,
      dni: version.dni,
      telefono: version.telefono,
      email: version.email,
      fechaNacimiento: version.fechaNacimiento,
      nroCredencial: version.nroCredencial,
      sexo: version.sexo,
    },
    data: {
      nombre: input.nombre,
      apellido: input.apellido,
      cuil: input.cuil,
      dni: input.dni,
      telefono: input.telefono,
      email: input.email,
      fechaNacimiento: input.fechaNacimiento,
      nroCredencial: input.nroCredencial,
      sexo: input.sexo,
    },
  });
  return result.count === 1;
}

export interface CambiarBajaPacienteInput {
  tenantId: string;
  id: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export async function cambiarBajaPaciente(tx: Prisma.TransactionClient, input: CambiarBajaPacienteInput): Promise<void> {
  await tx.paciente.update({
    where: { id: input.id, tenantId: input.tenantId },
    data: { fechaBaja: input.fechaBaja, motivoBaja: input.motivoBaja },
  });
}
