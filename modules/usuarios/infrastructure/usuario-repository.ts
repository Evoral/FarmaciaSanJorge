/**
 * Prisma-backed access to `fsj.usuario` / `fsj.usuario_rol` /
 * `fsj.usuario_estado_historial` / `fsj.credencial_activacion` for M03
 * (FASE 3 points 3.1-3.8). Every function here runs inside an ALREADY OPEN
 * tenant transaction (`tx`, handed in by `shared/usecase.ts`'s
 * `defineCommand`/`defineQuery`) -- nothing here opens its own transaction
 * or imports `shared/db/transaction` (that import is ESLint-forbidden
 * outside `modules/auth`, see eslint.config.mjs).
 *
 * `es_tecnico = true` (the per-tenant SISTEMA user) and the `SISTEMA` role
 * are filtered out of every read here -- the task requires that user and
 * role to never appear in any admin listing/picker/action (plan §9 M03
 * "NO HACER": roles/usuarios never exposes the technical user).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoUsuario as PrismaEstadoUsuario } from "@/generated/prisma/enums";
import type { RolAsignable } from "../domain/roles";

// ============================================================================
// Listing / detail (3.1, 3.7)
// ============================================================================

export interface ListUsuariosFilter {
  tenantId: string;
  search?: string;
  estado?: PrismaEstadoUsuario;
  rolCodigo?: RolAsignable;
  page: number;
  pageSize: number;
}

export interface UsuarioListItem {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  dni: string;
  estado: PrismaEstadoUsuario;
  ultimoAcceso: Date | null;
  roles: string[];
}

export interface ListUsuariosResult {
  items: UsuarioListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function buildListWhere(filter: ListUsuariosFilter): Prisma.UsuarioWhereInput {
  const where: Prisma.UsuarioWhereInput = {
    tenantId: filter.tenantId,
    esTecnico: false,
  };

  if (filter.search && filter.search.trim().length > 0) {
    const term = filter.search.trim();
    where.OR = [
      { nombre: { contains: term, mode: "insensitive" } },
      { apellido: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { dni: { contains: term, mode: "insensitive" } },
    ];
  }

  if (filter.estado) {
    where.estado = filter.estado;
  }

  if (filter.rolCodigo) {
    where.rolesAsignados = { some: { rol: { codigo: filter.rolCodigo } } };
  }

  return where;
}

export async function listUsuarios(tx: Prisma.TransactionClient, filter: ListUsuariosFilter): Promise<ListUsuariosResult> {
  const where = buildListWhere(filter);
  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows] = await Promise.all([
    tx.usuario.count({ where }),
    tx.usuario.findMany({
      where,
      orderBy: [{ apellido: "asc" }, { nombre: "asc" }],
      skip,
      take: filter.pageSize,
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        dni: true,
        estado: true,
        ultimoAcceso: true,
        rolesAsignados: { select: { rol: { select: { codigo: true } } } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      apellido: row.apellido,
      email: row.email,
      dni: row.dni,
      estado: row.estado,
      ultimoAcceso: row.ultimoAcceso,
      roles: row.rolesAsignados.map((asignacion) => asignacion.rol.codigo),
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

export interface UsuarioDetalle {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  dni: string;
  estado: PrismaEstadoUsuario;
  numeroMatricula: string | null;
  creadoEn: Date;
  ultimoAcceso: Date | null;
  fechaBaja: Date | null;
  motivoBaja: string | null;
  roles: string[];
}

/**
 * `null` for a nonexistent usuario OR the (hidden) technical user --
 * callers treat both as "not found". `tenantId` is an explicit,
 * defense-in-depth filter (N1, security review) on top of RLS -- same
 * discipline as every other repository function in this file (plan §8 "no
 * filtrar tenant a mano como única defensa", i.e. never RELY on RLS alone
 * when the tenant is already known).
 */
export async function getUsuarioDetalle(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string): Promise<UsuarioDetalle | null> {
  const row = await tx.usuario.findUnique({
    where: { id: usuarioId, tenantId },
    select: {
      id: true,
      nombre: true,
      apellido: true,
      email: true,
      dni: true,
      estado: true,
      numeroMatricula: true,
      creadoEn: true,
      ultimoAcceso: true,
      fechaBaja: true,
      motivoBaja: true,
      esTecnico: true,
      rolesAsignados: { select: { rol: { select: { codigo: true } } } },
    },
  });
  if (!row || row.esTecnico) return null;

  return {
    id: row.id,
    nombre: row.nombre,
    apellido: row.apellido,
    email: row.email,
    dni: row.dni,
    estado: row.estado,
    numeroMatricula: row.numeroMatricula,
    creadoEn: row.creadoEn,
    ultimoAcceso: row.ultimoAcceso,
    fechaBaja: row.fechaBaja,
    motivoBaja: row.motivoBaja,
    roles: row.rolesAsignados.map((asignacion) => asignacion.rol.codigo),
  };
}

export interface UsuarioParaAccion {
  id: string;
  estado: PrismaEstadoUsuario;
  esTecnico: boolean;
  roles: string[];
  nombre: string;
  apellido: string;
  email: string;
  dni: string;
  numeroMatricula: string | null;
}

/**
 * Minimum shape every mutating use case
 * (suspender/reactivar/baja/restablecer/cambiarRoles/editar) needs before
 * deciding anything. `null` for a nonexistent usuario or the technical
 * user. `tenantId` is an explicit, defense-in-depth filter (N1, security
 * review) on top of RLS -- see `getUsuarioDetalle`'s doc comment above.
 */
export async function loadUsuarioParaAccion(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string): Promise<UsuarioParaAccion | null> {
  const row = await tx.usuario.findUnique({
    where: { id: usuarioId, tenantId },
    select: {
      id: true,
      estado: true,
      esTecnico: true,
      nombre: true,
      apellido: true,
      email: true,
      dni: true,
      numeroMatricula: true,
      rolesAsignados: { select: { rol: { select: { codigo: true } } } },
    },
  });
  if (!row || row.esTecnico) return null;

  return {
    id: row.id,
    estado: row.estado,
    esTecnico: row.esTecnico,
    nombre: row.nombre,
    apellido: row.apellido,
    email: row.email,
    dni: row.dni,
    numeroMatricula: row.numeroMatricula,
    roles: row.rolesAsignados.map((asignacion) => asignacion.rol.codigo),
  };
}

// ============================================================================
// Uniqueness pre-checks (3.2/3.3 -- field-level duplicate errors, plan §16 3.2/3.3)
// ============================================================================

/** `true` if some OTHER usuario already has this email (globally unique -- DP-40). `excludeUsuarioId` lets editarUsuario ignore the row being edited. */
export async function existeEmail(tx: Prisma.TransactionClient, email: string, excludeUsuarioId?: string): Promise<boolean> {
  const row = await tx.usuario.findFirst({
    where: { email, ...(excludeUsuarioId ? { id: { not: excludeUsuarioId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

/** `true` if some OTHER usuario in the SAME tenant already has this dni (unique per tenant). */
export async function existeDni(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dni: string,
  excludeUsuarioId?: string,
): Promise<boolean> {
  const row = await tx.usuario.findFirst({
    where: { tenantId, dni, ...(excludeUsuarioId ? { id: { not: excludeUsuarioId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

// ============================================================================
// Writes: crear / editar (3.2 / 3.3)
// ============================================================================

export interface NuevoUsuarioInput {
  tenantId: string;
  nombre: string;
  apellido: string;
  email: string;
  dni: string;
  numeroMatricula: string | null;
  creadoPorId: string;
}

export async function insertUsuario(tx: Prisma.TransactionClient, input: NuevoUsuarioInput): Promise<{ id: string }> {
  return tx.usuario.create({
    data: {
      tenantId: input.tenantId,
      nombre: input.nombre,
      apellido: input.apellido,
      email: input.email,
      dni: input.dni,
      numeroMatricula: input.numeroMatricula ?? undefined,
      creadoPorId: input.creadoPorId,
      // estado defaults to PENDIENTE_ACTIVACION (schema default) -- never set explicitly (INV-U07).
    },
    select: { id: true },
  });
}

export interface AsignarRolInput {
  tenantId: string;
  usuarioId: string;
  rolCodigo: string;
  asignadoPorId: string;
}

export async function insertUsuarioRol(tx: Prisma.TransactionClient, input: AsignarRolInput): Promise<void> {
  const rol = await tx.rol.findUnique({ where: { codigo: input.rolCodigo }, select: { id: true } });
  if (!rol) {
    throw new Error(`insertUsuarioRol: unknown rol codigo "${input.rolCodigo}" -- this should have been rejected by zod's ROLES_ASIGNABLES enum before reaching the repository.`);
  }
  await tx.usuarioRol.create({
    data: { tenantId: input.tenantId, usuarioId: input.usuarioId, rolId: rol.id, asignadoPorId: input.asignadoPorId },
  });
}

export async function deleteUsuarioRol(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string, rolCodigo: string): Promise<void> {
  const rol = await tx.rol.findUnique({ where: { codigo: rolCodigo }, select: { id: true } });
  if (!rol) return;
  await tx.usuarioRol.deleteMany({ where: { tenantId, usuarioId, rolId: rol.id } });
}

export interface EditarUsuarioInput {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  dni: string;
  numeroMatricula: string | null;
}

export interface EditarUsuarioVersion {
  nombre: string;
  apellido: string;
  email: string;
  dni: string;
  numeroMatricula: string | null;
}

/**
 * Optimistic-concurrency UPDATE (plan's "el usuario fue modificado por otra
 * persona, recargá"): there is no `actualizado_en`/version column on
 * `fsj.usuario` yet (migration 0002 does not have one, and this task must
 * not add a migration), so the WHERE clause uses the exact field values the
 * edit form was loaded with (`version`) as the compare-and-swap key --
 * functionally equivalent to a version column for THIS table, since these
 * are exactly the columns this command can change. Returns `false` when
 * zero rows matched (either the row no longer exists, or it changed since
 * `version` was read) -- the caller distinguishes those by re-checking
 * existence.
 */
export async function updateUsuarioDatosPersonales(
  tx: Prisma.TransactionClient,
  input: EditarUsuarioInput,
  version: EditarUsuarioVersion,
): Promise<boolean> {
  const result = await tx.usuario.updateMany({
    where: {
      id: input.id,
      nombre: version.nombre,
      apellido: version.apellido,
      email: version.email,
      dni: version.dni,
      numeroMatricula: version.numeroMatricula,
    },
    data: {
      nombre: input.nombre,
      apellido: input.apellido,
      email: input.email,
      dni: input.dni,
      numeroMatricula: input.numeroMatricula ?? null,
    },
  });
  return result.count === 1;
}

// ============================================================================
// Estado (3.5 / 3.6): usuario.estado + usuario_estado_historial, together
// ============================================================================

export interface CambiarEstadoInput {
  tenantId: string;
  usuarioId: string;
  estadoAnterior: PrismaEstadoUsuario;
  estadoNuevo: PrismaEstadoUsuario;
  motivo: string | null;
  cambiadoPorId: string;
  now: Date;
  /** BAJA-specific columns (plan schema: usuario.fecha_baja/motivo_baja) -- set only when estadoNuevo === 'BAJA'. */
  bajaColumns?: { fechaBaja: Date; motivoBaja: string };
}

/**
 * Updates `usuario.estado` (+ BAJA columns when applicable) and appends
 * one `usuario_estado_historial` row, atomically (both statements run
 * inside the caller's `tx`).
 *
 * PIN re-auth feature (task requirement, user decision 2026-09-23):
 * whenever `estadoNuevo !== 'ACTIVO'`, the PIN is cleared in the SAME
 * statement/transaction as the estado change -- this covers exactly the
 * three transitions the task requires (suspenderUsuario -> SUSPENDIDO,
 * darDeBajaUsuario -> BAJA, restablecerCredencial -> PENDIENTE_ACTIVACION)
 * without each of those three call sites needing to remember to do it
 * separately, and WITHOUT clearing it on `reactivarUsuario` (-> ACTIVO,
 * the one caller of this function that must NOT lose the PIN).
 */
export async function cambiarEstadoUsuario(tx: Prisma.TransactionClient, input: CambiarEstadoInput): Promise<void> {
  await tx.usuario.update({
    where: { id: input.usuarioId },
    data: {
      estado: input.estadoNuevo,
      ...(input.bajaColumns ? { fechaBaja: input.bajaColumns.fechaBaja, motivoBaja: input.bajaColumns.motivoBaja } : {}),
      ...(input.estadoNuevo !== "ACTIVO"
        ? { pinHash: null, pinIntentosFallidos: 0, pinBloqueado: false, pinActualizadoEn: input.now }
        : {}),
    },
  });

  await tx.usuarioEstadoHistorial.create({
    data: {
      tenantId: input.tenantId,
      usuarioId: input.usuarioId,
      estadoAnterior: input.estadoAnterior,
      estadoNuevo: input.estadoNuevo,
      motivo: input.motivo ?? undefined,
      cambiadoPorId: input.cambiadoPorId,
    },
  });
}

export interface UsuarioEstadoHistorialRow {
  id: string;
  estadoAnterior: PrismaEstadoUsuario | null;
  estadoNuevo: PrismaEstadoUsuario;
  motivo: string | null;
  cambiadoEn: Date;
  cambiadoPor: { id: string; nombre: string; apellido: string };
}

export async function listUsuarioEstadoHistorial(tx: Prisma.TransactionClient, usuarioId: string): Promise<UsuarioEstadoHistorialRow[]> {
  const rows = await tx.usuarioEstadoHistorial.findMany({
    where: { usuarioId },
    orderBy: { cambiadoEn: "desc" },
    select: {
      id: true,
      estadoAnterior: true,
      estadoNuevo: true,
      motivo: true,
      cambiadoEn: true,
      cambiadoPor: { select: { id: true, nombre: true, apellido: true } },
    },
  });
  return rows;
}

// ============================================================================
// Credentials (3.2 / 3.6): reuses the exact hashing/format from
// modules/auth/domain/token.ts and scripts/create-tenant.ts.
// ============================================================================

export interface EmitirCredencialInput {
  tenantId: string;
  usuarioId: string;
  tokenHash: string;
  emitidaPorId: string;
  venceEn: Date;
  motivoEmision: "ALTA" | "RESTABLECIMIENTO";
}

export async function insertCredencialActivacion(tx: Prisma.TransactionClient, input: EmitirCredencialInput): Promise<void> {
  await tx.credencialActivacion.create({
    data: {
      tenantId: input.tenantId,
      usuarioId: input.usuarioId,
      tokenHash: input.tokenHash,
      emitidaPorId: input.emitidaPorId,
      venceEn: input.venceEn,
      motivoEmision: input.motivoEmision,
    },
  });
}

/** Revokes every non-used, non-revoked credential for a usuario (INV-U08: reset -- and suspend/baja, task's binding decision -- must invalidate pending credentials too). Returns the number revoked. */
export async function revokeCredencialesActivas(
  tx: Prisma.TransactionClient,
  tenantId: string,
  usuarioId: string,
  now: Date,
): Promise<number> {
  const result = await tx.credencialActivacion.updateMany({
    where: { tenantId, usuarioId, usadaEn: null, revocadaEn: null },
    data: { revocadaEn: now },
  });
  return result.count;
}

// ============================================================================
// Roles catalog (3.8 -- read-only)
// ============================================================================

export interface RolConPermisos {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  permisos: string[];
}

/** Excludes SISTEMA (never shown -- plan's binding decision). */
export async function listRolesConPermisos(tx: Prisma.TransactionClient): Promise<RolConPermisos[]> {
  const rows = await tx.rol.findMany({
    where: { codigo: { not: "SISTEMA" } },
    orderBy: { nombre: "asc" },
    select: {
      codigo: true,
      nombre: true,
      descripcion: true,
      permisos: { select: { permiso: { select: { codigo: true } } } },
    },
  });
  return rows.map((row) => ({
    codigo: row.codigo,
    nombre: row.nombre,
    descripcion: row.descripcion,
    permisos: row.permisos.map((p) => p.permiso.codigo).sort(),
  }));
}

// ============================================================================
// Designación DT cross-check (cambiarRoles, plan's binding decision: "Removing
// the DIRECTOR_TECNICO role from a user with a current designation must be
// rejected"). Read-only against a table owned by M04 (migration 0005) --
// reading another module's table via the shared Prisma `tx` is not an
// architecture-boundary violation (only reaching into another module's
// infrastructure/** files would be); M04's own use cases (FASE 3.9,
// out of this task's scope) are not touched here.
// ============================================================================

export async function tieneDesignacionDtVigente(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string): Promise<boolean> {
  const row = await tx.designacionDirectorTecnico.findFirst({
    where: { tenantId, usuarioId, vigenteHasta: null },
    select: { id: true },
  });
  return row !== null;
}
