/**
 * Prisma-backed access to `fsj.designacion_director_tecnico` for M04
 * (FASE 3 point 3.9). Every function here runs inside an ALREADY OPEN
 * tenant transaction (`tx`, handed in by `shared/usecase.ts`'s
 * `defineCommand`/`defineQuery`) -- nothing here opens its own transaction
 * or imports `shared/db/transaction` (ESLint-forbidden outside
 * `modules/auth`, see eslint.config.mjs).
 *
 * The DB is authoritative for every INV-DT-XXX invariant (triggers +
 * EXCLUDE constraint, migrations 0005/0021) -- this file does not
 * re-implement any of them, it only shapes reads/writes and surfaces
 * whatever the DB rejects (mapDbError, called by `withTenantTransaction`,
 * turns that into the right `AppError`).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoUsuario as PrismaEstadoUsuario } from "@/generated/prisma/enums";
import type { CaracterDesignacion } from "../domain/designacion";

// ============================================================================
// Read: fresh usuario.estado, for designarDirectorTecnico's app-level
// ACTIVO pre-check (FASE 3 point 3.9 review finding M1). A thin, scoped
// read of exactly the column that check needs -- this module cannot import
// modules/usuarios/infrastructure (eslint.config.mjs's appBoundaryPatterns
// forbids any modules/**/*.ts from reaching into another module's
// infrastructure/ layer, not just app/**), so it reads fsj.usuario itself
// here, the same way listUsuariosElegibles below already does.
// ============================================================================

/** `null` if the usuario does not exist (or belongs to another tenant). */
export async function getUsuarioEstado(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string): Promise<PrismaEstadoUsuario | null> {
  const row = await tx.usuario.findUnique({
    where: { id: usuarioId, tenantId },
    select: { estado: true },
  });
  return row?.estado ?? null;
}

// ============================================================================
// Write: designar (INSERT-only -- INV-DT-001/002/005 are DB-enforced on INSERT)
// ============================================================================

export interface NuevaDesignacionInput {
  tenantId: string;
  usuarioId: string;
  caracter: CaracterDesignacion;
  matricula: string;
  expedienteDesignacion: string | null;
  /** `YYYY-MM-DD` -- see domain/designacion.ts's `isoDate`. */
  vigenteDesde: string;
  registradoPorId: string;
}

export async function insertDesignacion(tx: Prisma.TransactionClient, input: NuevaDesignacionInput): Promise<{ id: string }> {
  return tx.designacionDirectorTecnico.create({
    data: {
      tenantId: input.tenantId,
      usuarioId: input.usuarioId,
      caracter: input.caracter,
      matricula: input.matricula,
      expedienteDesignacion: input.expedienteDesignacion ?? undefined,
      vigenteDesde: new Date(input.vigenteDesde),
      registradoPorId: input.registradoPorId,
    },
    select: { id: true },
  });
}

// ============================================================================
// Write: cese (UPDATE of exactly vigente_hasta + motivo_cese -- the only
// columns fsj_app is granted UPDATE on; INV-DT-003/004 are DB-enforced)
// ============================================================================

export interface DesignacionParaCese {
  id: string;
  usuarioId: string;
  caracter: CaracterDesignacion;
  matricula: string;
  vigenteDesde: Date;
  vigenteHasta: Date | null;
  motivoCese: string | null;
}

/** `null` if the designacion does not exist (or belongs to another tenant). */
export async function getDesignacionParaCese(tx: Prisma.TransactionClient, tenantId: string, designacionId: string): Promise<DesignacionParaCese | null> {
  const row = await tx.designacionDirectorTecnico.findUnique({
    where: { id: designacionId, tenantId },
    select: { id: true, usuarioId: true, caracter: true, matricula: true, vigenteDesde: true, vigenteHasta: true, motivoCese: true },
  });
  return row;
}

export interface CesarDesignacionInput {
  tenantId: string;
  designacionId: string;
  vigenteHasta: string;
  motivoCese: string;
}

/**
 * Cese is final: only ever writes `vigente_hasta` + `motivo_cese`. INV-DT-003
 * (immutable once set) and INV-DT-004 (retroactive-cese-vs-signed-cierre
 * guard, migration 0021) fire as DB triggers and surface through
 * `mapDbError` -- this function does not attempt to pre-validate either.
 */
export async function cesarDesignacion(tx: Prisma.TransactionClient, input: CesarDesignacionInput): Promise<void> {
  await tx.designacionDirectorTecnico.update({
    where: { id: input.designacionId, tenantId: input.tenantId },
    data: {
      vigenteHasta: new Date(input.vigenteHasta),
      motivoCese: input.motivoCese,
    },
  });
}

// ============================================================================
// Reads: listado (current + historical) and detalle
// ============================================================================

export interface ListDesignacionesFilter {
  tenantId: string;
  /** `true` = only vigente_hasta IS NULL (no cese registered yet); `false` = only ya cesadas; omitted = both. */
  soloVigentes?: boolean;
  page: number;
  pageSize: number;
}

export interface DesignacionListItem {
  id: string;
  usuarioId: string;
  usuarioNombre: string;
  usuarioApellido: string;
  caracter: CaracterDesignacion;
  matricula: string;
  expedienteDesignacion: string | null;
  vigenteDesde: Date;
  vigenteHasta: Date | null;
  motivoCese: string | null;
  registradoEn: Date;
}

export interface ListDesignacionesResult {
  items: DesignacionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listDesignaciones(tx: Prisma.TransactionClient, filter: ListDesignacionesFilter): Promise<ListDesignacionesResult> {
  const where: Prisma.DesignacionDirectorTecnicoWhereInput = { tenantId: filter.tenantId };
  if (filter.soloVigentes === true) {
    where.vigenteHasta = null;
  } else if (filter.soloVigentes === false) {
    where.vigenteHasta = { not: null };
  }

  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows] = await Promise.all([
    tx.designacionDirectorTecnico.count({ where }),
    tx.designacionDirectorTecnico.findMany({
      where,
      orderBy: [{ vigenteDesde: "desc" }],
      skip,
      take: filter.pageSize,
      select: {
        id: true,
        usuarioId: true,
        caracter: true,
        matricula: true,
        expedienteDesignacion: true,
        vigenteDesde: true,
        vigenteHasta: true,
        motivoCese: true,
        registradoEn: true,
        usuario: { select: { nombre: true, apellido: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      usuarioId: row.usuarioId,
      usuarioNombre: row.usuario.nombre,
      usuarioApellido: row.usuario.apellido,
      caracter: row.caracter,
      matricula: row.matricula,
      expedienteDesignacion: row.expedienteDesignacion,
      vigenteDesde: row.vigenteDesde,
      vigenteHasta: row.vigenteHasta,
      motivoCese: row.motivoCese,
      registradoEn: row.registradoEn,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

// ============================================================================
// Read: "quien es DT vigente hoy" -- direct WHERE against today's date
// (simpler than a $queryRaw call to fsj.es_dt_vigente(), and equivalent for
// "today" -- fsj.es_dt_vigente() is meant for a SPECIFIC business date,
// e.g. cierre.fecha, used by other modules out of this task's scope).
// ============================================================================

export interface DtVigenteHoyItem {
  designacionId: string;
  usuarioId: string;
  usuarioNombre: string;
  usuarioApellido: string;
  matricula: string;
  vigenteDesde: Date;
}

export interface DtVigenteHoyResult {
  titular: DtVigenteHoyItem | null;
  suplentes: DtVigenteHoyItem[];
}

export async function dtVigenteHoy(tx: Prisma.TransactionClient, tenantId: string): Promise<DtVigenteHoyResult> {
  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);

  const rows = await tx.designacionDirectorTecnico.findMany({
    where: {
      tenantId,
      vigenteDesde: { lte: hoy },
      OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: hoy } }],
    },
    orderBy: [{ vigenteDesde: "desc" }],
    select: {
      id: true,
      usuarioId: true,
      caracter: true,
      matricula: true,
      vigenteDesde: true,
      usuario: { select: { nombre: true, apellido: true } },
    },
  });

  function toItem(row: (typeof rows)[number]): DtVigenteHoyItem {
    return {
      designacionId: row.id,
      usuarioId: row.usuarioId,
      usuarioNombre: row.usuario.nombre,
      usuarioApellido: row.usuario.apellido,
      matricula: row.matricula,
      vigenteDesde: row.vigenteDesde,
    };
  }

  // INV-DT-002 guarantees at most one VIGENTE TITULAR at any moment -- take
  // the first (and only) match rather than asserting length === 1 here
  // (a defensive read should not itself throw on an unexpected DB state).
  const titular = rows.find((row) => row.caracter === "TITULAR");
  const suplentes = rows.filter((row) => row.caracter === "SUPLENTE");

  return {
    titular: titular ? toItem(titular) : null,
    suplentes: suplentes.map(toItem),
  };
}

// ============================================================================
// Read: usuarios elegibles para designar (role DIRECTOR_TECNICO, ACTIVO,
// current tenant) -- for the "nuevo" designation form's usuario picker.
// ============================================================================

export interface UsuarioElegible {
  id: string;
  nombre: string;
  apellido: string;
  dni: string;
}

export async function listUsuariosElegibles(tx: Prisma.TransactionClient, tenantId: string): Promise<UsuarioElegible[]> {
  const rows = await tx.usuario.findMany({
    where: {
      tenantId,
      estado: "ACTIVO",
      esTecnico: false,
      rolesAsignados: { some: { rol: { codigo: "DIRECTOR_TECNICO" } } },
    },
    orderBy: [{ apellido: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, apellido: true, dni: true },
  });
  return rows;
}
