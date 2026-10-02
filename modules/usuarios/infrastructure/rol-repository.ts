/**
 * Prisma-backed access to the per-tenant role catalog (`fsj.rol` /
 * `fsj.rol_permiso`, migration 0054) and the global `fsj.permiso` catalog,
 * for DP-03's role management (modules/usuarios/application/*-rol*.ts) and
 * for the usuarios forms that pick roles. Same discipline as
 * usuario-repository.ts: runs inside the caller's tenant transaction, and
 * every query filters `tenantId` explicitly on top of RLS (plan §8: never
 * rely on RLS alone when the tenant is already known).
 *
 * The SISTEMA role is never returned by a listing here (it is hidden from
 * every admin screen); lookups by id/codigo DO return it, so the use cases
 * can reject it with a precise message instead of a misleading "not found".
 */
import type { Prisma } from "@/generated/prisma/client";
import { categoriaDePermiso, isPermiso, esPermisoAsignableARol, PERMISO_CODES, PERMISOS_DE_ADMINISTRADOR, type Permiso } from "@/modules/auth/domain/permisos";
import { ROL_SISTEMA, type PermisoCatalogo } from "../domain/roles";

export interface RolDetalle {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  esAdministrador: boolean;
  /** EFFECTIVE permisos, sorted: every consulta/gestion permiso of the catalog for `esAdministrador` (never operativo), the rol_permiso rows otherwise. */
  permisos: Permiso[];
  /** usuarios currently holding the role (any estado). */
  cantidadUsuarios: number;
}

const ROL_DETALLE_SELECT = {
  id: true,
  codigo: true,
  nombre: true,
  descripcion: true,
  esAdministrador: true,
  permisos: { select: { permiso: { select: { codigo: true } } } },
  _count: { select: { asignaciones: true } },
} as const;

type RolDetalleRow = Prisma.RolGetPayload<{ select: typeof ROL_DETALLE_SELECT }>;

function permisosEfectivos(esAdministrador: boolean, codigos: readonly string[]): Permiso[] {
  if (esAdministrador) return [...PERMISOS_DE_ADMINISTRADOR].sort();
  // isPermiso: never trust an unrecognized DB string into the Permiso union (same guard as the session loader).
  return codigos.filter(isPermiso).sort();
}

function toRolDetalle(row: RolDetalleRow): RolDetalle {
  return {
    id: row.id,
    codigo: row.codigo,
    nombre: row.nombre,
    descripcion: row.descripcion,
    esAdministrador: row.esAdministrador,
    permisos: permisosEfectivos(
      row.esAdministrador,
      row.permisos.map((p) => p.permiso.codigo),
    ),
    cantidadUsuarios: row._count.asignaciones,
  };
}

/** Every role of the tenant except SISTEMA, ADMINISTRADOR first, then by nombre. */
export async function listRolesDelTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<RolDetalle[]> {
  const rows = await tx.rol.findMany({
    where: { tenantId, codigo: { not: ROL_SISTEMA } },
    orderBy: [{ esAdministrador: "desc" }, { nombre: "asc" }],
    select: ROL_DETALLE_SELECT,
  });
  return rows.map(toRolDetalle);
}

/** `null` when no role with that id exists in the tenant. Returns SISTEMA too (callers decide). */
export async function findRolById(tx: Prisma.TransactionClient, tenantId: string, rolId: string): Promise<RolDetalle | null> {
  const row = await tx.rol.findUnique({ where: { tenantId_id: { tenantId, id: rolId } }, select: ROL_DETALLE_SELECT });
  return row ? toRolDetalle(row) : null;
}

/**
 * Row-locks the role (`SELECT ... FOR UPDATE`) for the rest of the
 * transaction, so two concurrent edits/deletes of the SAME role serialize:
 * the second one re-reads the permisos AFTER the first commits, which keeps
 * its escalation check and its audit `valorAnterior` truthful. Returns
 * `false` when the role does not exist in the tenant.
 */
export async function lockRol(tx: Prisma.TransactionClient, tenantId: string, rolId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT r.id FROM fsj.rol r
    WHERE r.tenant_id = ${tenantId}::uuid AND r.id = ${rolId}::uuid
    FOR UPDATE
  `;
  return rows.length === 1;
}

/** Every role code of the tenant (SISTEMA included) -- the uniqueness set for `generarCodigoRol`. */
export async function listCodigosDeRol(tx: Prisma.TransactionClient, tenantId: string): Promise<Set<string>> {
  const rows = await tx.rol.findMany({ where: { tenantId }, select: { codigo: true } });
  return new Set(rows.map((row) => row.codigo));
}

/** `true` if ANOTHER role of the tenant already uses this nombre (case-insensitive -- same rule as the DB's rol_tenant_nombre_key). */
export async function existeNombreDeRol(tx: Prisma.TransactionClient, tenantId: string, nombre: string, excludeRolId?: string): Promise<boolean> {
  const row = await tx.rol.findFirst({
    where: {
      tenantId,
      nombre: { equals: nombre, mode: "insensitive" },
      ...(excludeRolId ? { id: { not: excludeRolId } } : {}),
    },
    select: { id: true },
  });
  return row !== null;
}

export interface NuevoRolInput {
  tenantId: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
}

export async function insertRol(tx: Prisma.TransactionClient, input: NuevoRolInput): Promise<{ id: string }> {
  return tx.rol.create({
    data: { tenantId: input.tenantId, codigo: input.codigo, nombre: input.nombre, descripcion: input.descripcion },
    select: { id: true },
  });
}

export async function updateDatosDeRol(
  tx: Prisma.TransactionClient,
  tenantId: string,
  rolId: string,
  datos: { nombre: string; descripcion: string | null },
): Promise<void> {
  await tx.rol.update({ where: { tenantId_id: { tenantId, id: rolId } }, data: { nombre: datos.nombre, descripcion: datos.descripcion } });
}

/**
 * Makes the role's rol_permiso rows EXACTLY `permisos` (delete the extra
 * pairs, insert the missing ones -- untouched pairs are left alone).
 * `permisos` must already be catalog-validated; the FK to fsj.permiso is
 * the backstop.
 */
export async function reemplazarPermisosDeRol(
  tx: Prisma.TransactionClient,
  tenantId: string,
  rolId: string,
  permisos: readonly Permiso[],
): Promise<void> {
  const catalogo = await tx.permiso.findMany({ where: { codigo: { in: [...permisos] } }, select: { id: true, codigo: true } });
  if (catalogo.length !== new Set(permisos).size) {
    throw new Error("reemplazarPermisosDeRol: a permiso is missing from fsj.permiso -- PERMISO_CODES and the catalog drifted (tests/db/auth-permisos.test.ts).");
  }
  const deseados = new Set(catalogo.map((p) => p.id));

  const actuales = await tx.rolPermiso.findMany({ where: { tenantId, rolId }, select: { permisoId: true } });
  const actualesIds = new Set(actuales.map((p) => p.permisoId));

  const aQuitar = [...actualesIds].filter((id) => !deseados.has(id));
  const aAgregar = [...deseados].filter((id) => !actualesIds.has(id));

  if (aQuitar.length > 0) {
    await tx.rolPermiso.deleteMany({ where: { tenantId, rolId, permisoId: { in: aQuitar } } });
  }
  if (aAgregar.length > 0) {
    await tx.rolPermiso.createMany({ data: aAgregar.map((permisoId) => ({ tenantId, rolId, permisoId })) });
  }
}

export async function deleteRol(tx: Prisma.TransactionClient, tenantId: string, rolId: string): Promise<void> {
  await tx.rol.delete({ where: { tenantId_id: { tenantId, id: rolId } } });
}

/** Codes of every role the usuario holds (the actor's own roles, for "you cannot manage a role you hold"). */
export async function codigosDeRolesDelUsuario(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string): Promise<string[]> {
  const rows = await tx.usuarioRol.findMany({
    where: { tenantId, usuarioId },
    select: { rol: { select: { codigo: true } } },
  });
  return rows.map((row) => row.rol.codigo);
}

export interface RolAsignableRow {
  id: string;
  codigo: string;
  nombre: string;
  esAdministrador: boolean;
  /** EFFECTIVE permisos (see `RolDetalle.permisos`). */
  permisos: Permiso[];
}

/** The tenant's roles with these codes (SISTEMA included if asked -- the caller rejects it). Unknown codes are simply absent from the result. */
export async function findRolesPorCodigo(tx: Prisma.TransactionClient, tenantId: string, codigos: readonly string[]): Promise<RolAsignableRow[]> {
  const rows = await tx.rol.findMany({
    where: { tenantId, codigo: { in: [...codigos] } },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      esAdministrador: true,
      permisos: { select: { permiso: { select: { codigo: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    codigo: row.codigo,
    nombre: row.nombre,
    esAdministrador: row.esAdministrador,
    permisos: permisosEfectivos(
      row.esAdministrador,
      row.permisos.map((p) => p.permiso.codigo),
    ),
  }));
}

export interface RolOpcion {
  codigo: string;
  nombre: string;
}

/** Role picker options for the usuarios forms/filters: every role but SISTEMA, by nombre. */
export async function listRolesAsignables(tx: Prisma.TransactionClient, tenantId: string): Promise<RolOpcion[]> {
  return tx.rol.findMany({
    where: { tenantId, codigo: { not: ROL_SISTEMA } },
    orderBy: { nombre: "asc" },
    select: { codigo: true, nombre: true },
  });
}

/**
 * The role-assignable part of the global permiso catalog, in
 * `PERMISO_CODES` order, with each permiso's human description. A DB row
 * whose code is not in `PERMISO_CODES` is skipped (never offered).
 */
export async function listCatalogoPermisos(tx: Prisma.TransactionClient): Promise<PermisoCatalogo[]> {
  const rows = await tx.permiso.findMany({ select: { codigo: true, descripcion: true } });
  const orden = new Map<string, number>(PERMISO_CODES.map((codigo, index) => [codigo, index]));
  return rows
    .filter((row): row is { codigo: Permiso; descripcion: string | null } => esPermisoAsignableARol(row.codigo))
    .sort((a, b) => orden.get(a.codigo)! - orden.get(b.codigo)!)
    .map((row) => ({ codigo: row.codigo, descripcion: row.descripcion ?? row.codigo, categoria: categoriaDePermiso(row.codigo) }));
}
