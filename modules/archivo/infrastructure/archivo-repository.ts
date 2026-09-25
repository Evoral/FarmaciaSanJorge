/**
 * Prisma/raw-SQL access to `fsj.lote_archivo_recetas` + the `fsj.receta`
 * reads/locks FASE 12 (M15, points 12.1-12.3) needs. Every function here
 * runs inside an ALREADY OPEN transaction (`tx`) -- `withTenantTransaction`
 * for everything session-driven, plain `withTenantTransaction` per-tenant
 * for the daily job too (FASE 12 point 12.2 -- the job iterates tenants
 * itself, see `application/actualizar-plazos.ts`).
 *
 * `modules/archivo` cannot import `modules/cierres/infrastructure/**` or
 * `modules/entregas/infrastructure/**` (eslint's `appBoundaryPatterns`
 * forbids ANY `modules/**\/*.ts` from reaching into another module's
 * `infrastructure/` layer) -- the jornada/parametro/password-verification
 * helpers below are OWN COPIES, same "own copy per module" discipline those
 * two modules' own repositories already establish.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoUsuario } from "@/generated/prisma/enums";
import { record as auditRecord } from "@/shared/audit";
import { Prisma as PrismaRuntime, TipoAccion } from "@/generated/prisma/client";
import type { EstadoLoteArchivoValue } from "../domain/lote-archivo";

// ============================================================================
// `vencimiento` single source of truth (FASE 12 point 12.2, DP-26 PARCIAL).
// `vencimiento = periodo_hasta + N años` (N per `incluye_controladas`) is
// computed HERE, in SQL, and nowhere else -- `moverPlazoCumplidoTenant`
// (the job/button transition), `listLotes`/`getLoteDetalle` (the list/detail
// display + "plazo cumplido" badge) all splice in this exact fragment so
// the three call sites can never disagree. Verified against a live
// Postgres (`SELECT ('2024-02-29'::date + make_interval(years => 1))::date`
// -> `2025-02-28`): `date + interval` CLAMPS 29 Feb to 28 Feb on a
// non-leap target year, it does not roll over to 1 Mar. The domain layer
// used to keep its own JS clamp of this same rule for display -- removed,
// see `modules/archivo/domain/lote-archivo.ts`'s doc comment.
// ============================================================================

function vencimientoFragment(plazos: { comunAnios: number; controladasAnios: number }): Prisma.Sql {
  return PrismaRuntime.sql`(l.periodo_hasta + make_interval(years => CASE WHEN l.incluye_controladas THEN ${plazos.controladasAnios}::int ELSE ${plazos.comunAnios}::int END))::date`;
}

export interface VencimientoInfo {
  vencimiento: string;
  plazoCumplido: boolean;
}

/** Batched lookup of `vencimiento`/`plazoCumplido` for a set of lote ids, using the SAME fragment as `moverPlazoCumplidoTenant` (see module doc comment above). Used by `listLotes`/`getLoteDetalle` so the list/detail display never re-derives this in JS. */
async function fetchVencimientos(tx: Prisma.TransactionClient, tenantId: string, ids: string[], plazos: { comunAnios: number; controladasAnios: number }): Promise<Map<string, VencimientoInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ id: string; vencimiento: string; plazo_cumplido: boolean }[]>`
    SELECT
      l.id,
      ${vencimientoFragment(plazos)}::text AS vencimiento,
      (${vencimientoFragment(plazos)} <= fsj.jornada_actual(l.tenant_id)) AS plazo_cumplido
    FROM fsj.lote_archivo_recetas l
    WHERE l.tenant_id = ${tenantId}::uuid AND l.id = ANY(${ids}::uuid[])
  `;
  return new Map(rows.map((r) => [r.id, { vencimiento: r.vencimiento, plazoCumplido: r.plazo_cumplido }]));
}

// ============================================================================
// jornada / parametro helpers -- own copies (see module doc comment).
// ============================================================================

export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

/** `plazo_archivo_comun_anios` / `plazo_archivo_controladas_anios` (DP-26 PARCIAL, migration 0042) -- default to 2/3 when the tenant somehow lacks the row (same defensive fallback discipline as every other `fsj.parametro` reader in this codebase). */
export async function getPlazosArchivo(tx: Prisma.TransactionClient, tenantId: string): Promise<{ comunAnios: number; controladasAnios: number }> {
  const rows = await tx.parametro.findMany({
    where: { tenantId, clave: { in: ["plazo_archivo_comun_anios", "plazo_archivo_controladas_anios"] } },
    select: { clave: true, valor: true },
  });
  const byClave = new Map(rows.map((r) => [r.clave, r.valor]));
  const parseOr = (clave: string, fallback: number): number => {
    const raw = byClave.get(clave);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
  };
  return { comunAnios: parseOr("plazo_archivo_comun_anios", 2), controladasAnios: parseOr("plazo_archivo_controladas_anios", 3) };
}

// ============================================================================
// Password verification (own copy of modules/cierres/infrastructure/cierre-repository.ts's
// cargarUsuarioParaPasswordFirma/registrarFallaPasswordFirma/registrarExitoPasswordFirma
// -- FASE 12 point 12.3, user decision 5: same "DT's own full password,
// PIN never accepted" discipline as firmar-cierre.ts).
// ============================================================================

export interface UsuarioParaPasswordDestruccion {
  passwordHash: string | null;
  estado: EstadoUsuario;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

export async function cargarUsuarioParaPasswordDestruccion(tx: Prisma.TransactionClient, usuarioId: string): Promise<UsuarioParaPasswordDestruccion | null> {
  return tx.usuario.findUnique({
    where: { id: usuarioId },
    select: { passwordHash: true, estado: true, intentosFallidos: true, bloqueadoHasta: true },
  });
}

export interface DestruccionPasswordFailureUpdate {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

export async function registrarFallaPasswordDestruccion(tx: Prisma.TransactionClient, usuarioId: string, update: DestruccionPasswordFailureUpdate): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { intentosFallidos: update.intentosFallidos, bloqueadoHasta: update.bloqueadoHasta } });
}

export async function registrarExitoPasswordDestruccion(tx: Prisma.TransactionClient, usuarioId: string, now: Date): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoAcceso: now } });
}

// ============================================================================
// 12.1: recetas elegibles + incluye_controladas derivation.
// ============================================================================

export interface RecetaElegibleRow {
  id: string;
  numeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  estado: "ENTREGADA" | "ANULADA";
  fechaIngreso: string;
}

/** User decision 4: estado ENTREGADA/ANULADA, receta_fisica_recibida, sin lote asignado, fecha_ingreso (date part, tenant zona_horaria) dentro del período. `fecha_ingreso` is cast to the TENANT's own zona_horaria, never UTC/server-local -- same discipline `fsj.jornada_actual()` uses server-side. */
export async function listRecetasElegibles(tx: Prisma.TransactionClient, tenantId: string, periodoDesde: string, periodoHasta: string): Promise<RecetaElegibleRow[]> {
  const rows = await tx.$queryRaw<{ id: string; numero_interno: string; paciente_nombre: string; paciente_apellido: string; estado: "ENTREGADA" | "ANULADA"; fecha_ingreso: string }[]>`
    SELECT
      r.id,
      r.numero_interno::text AS numero_interno,
      p.nombre AS paciente_nombre,
      p.apellido AS paciente_apellido,
      r.estado,
      (r.fecha_ingreso AT TIME ZONE 'UTC' AT TIME ZONE t.zona_horaria)::date::text AS fecha_ingreso
    FROM fsj.receta r
    JOIN fsj.paciente p ON p.tenant_id = r.tenant_id AND p.id = r.paciente_id
    JOIN fsj.tenant t ON t.id = r.tenant_id
    WHERE r.tenant_id = ${tenantId}::uuid
      AND r.estado IN ('ENTREGADA', 'ANULADA')
      AND r.receta_fisica_recibida = true
      AND r.lote_archivo_id IS NULL
      AND (r.fecha_ingreso AT TIME ZONE 'UTC' AT TIME ZONE t.zona_horaria)::date BETWEEN ${periodoDesde}::date AND ${periodoHasta}::date
    ORDER BY r.fecha_ingreso ASC
  `;
  return rows.map((r) => ({
    id: r.id,
    numeroInterno: r.numero_interno,
    pacienteNombre: r.paciente_nombre,
    pacienteApellido: r.paciente_apellido,
    estado: r.estado,
    fechaIngreso: r.fecha_ingreso,
  }));
}

/** User decision 3: true iff ANY selected receta has an item whose fórmula uses a droga with `es_controlada = true` (receta -> item_receta -> componente_item_receta -> droga). Computed BEFORE the lote INSERT (see `application/conformar-lote.ts`). */
export async function derivarIncluyeControladas(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<boolean> {
  if (recetaIds.length === 0) return false;
  const rows = await tx.$queryRaw<{ existe: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM fsj.item_receta ir
      JOIN fsj.componente_item_receta c ON c.tenant_id = ir.tenant_id AND c.item_receta_id = ir.id
      JOIN fsj.droga d ON d.tenant_id = c.tenant_id AND d.id = c.droga_id
      WHERE ir.tenant_id = ${tenantId}::uuid
        AND ir.receta_id = ANY(${recetaIds}::uuid[])
        AND d.es_controlada = true
    ) AS existe
  `;
  return rows[0]?.existe ?? false;
}

/** Locks every candidate receta (`SELECT ... FOR UPDATE`) -- `fsj.receta` has an UPDATE grant (multiple columns, migrations 0011/0016/0040), so `fsj_app` CAN take this lock (verified against this task's own gotcha note: `lote_archivo_recetas` also has column UPDATE grants, but the lock point is the receta row, same as `modules/entregas/infrastructure/entrega-repository.ts#lockRecetaParaAccion`). Prevents two concurrent `conformarLote` calls from racing over the same eligible receta -- migration 0016/0042's INV-ARC-006 trigger is the hard backstop regardless.
 *
 * NOTE this only locks rows that still EXIST for this tenant/id set -- it does
 * NOT re-check `estado`/`receta_fisica_recibida`/`lote_archivo_id`. A receta
 * committed to a DIFFERENT lote by a concurrent transaction between this
 * handler's initial `listRecetasElegibles` read and this lock would still be
 * found and locked here (same row, new `lote_archivo_id`). Callers MUST
 * follow this with `recheckRecetasElegibles` before trusting the id list --
 * see that function's doc comment. */
export async function lockRecetasParaArchivo(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<number> {
  if (recetaIds.length === 0) return 0;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.receta WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${recetaIds}::uuid[]) FOR UPDATE
  `;
  return rows.length;
}

/**
 * Re-checks eligibility of already-LOCKED recetas (must run right after
 * `lockRecetasParaArchivo` in the same transaction). `lockRecetasParaArchivo`
 * only verifies the rows still EXIST for this tenant/id set -- it does not
 * re-read `estado`/`receta_fisica_recibida`/`lote_archivo_id`, so a receta a
 * CONCURRENT transaction committed to a different lote between this
 * handler's initial read and this lock would otherwise be silently
 * archived into BOTH lotes' displayed recetas (the DB itself would reject
 * the second `UPDATE ... SET lote_archivo_id` via `lote_archivo_id IS NULL`
 * not matching -- but by then `asignarRecetasALote`'s `updateMany` would
 * have SILENTLY skipped that row instead of failing loud, since
 * `updateMany`'s `WHERE id IN (...)` has no `lote_archivo_id IS NULL`
 * guard). Same eligibility rule as `listRecetasElegibles`'s WHERE clause
 * (user decision 4), restricted to the already-selected id set. Returns the
 * ids that are STILL eligible right now.
 */
export async function recheckRecetasElegibles(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<string[]> {
  if (recetaIds.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.receta
    WHERE tenant_id = ${tenantId}::uuid
      AND id = ANY(${recetaIds}::uuid[])
      AND estado IN ('ENTREGADA', 'ANULADA')
      AND receta_fisica_recibida = true
      AND lote_archivo_id IS NULL
  `;
  return rows.map((r) => r.id);
}

export interface ConformarLoteInput {
  tenantId: string;
  periodoDesde: string;
  periodoHasta: string;
  ubicacion: string;
  incluyeControladas: boolean;
  registradoPorId: string;
  recetaIds: string[];
}

export interface LoteCreado {
  id: string;
  numero: string;
}

/** INSERTs the lote row (numero assigned by the DB trigger, migration 0042) THEN assigns every receta -- must run in this order, migration 0016/0042's `trg_receta_validar_archivo` reads the target lote's `incluye_controladas` (INV-ARC-007) so the lote row must already exist and be correct. */
export async function insertLote(tx: Prisma.TransactionClient, input: ConformarLoteInput): Promise<LoteCreado> {
  const lote = await tx.loteArchivoRecetas.create({
    data: {
      tenantId: input.tenantId,
      // numero is overwritten by fsj.lote_archivo_recetas_asignar_numero()
      // regardless (BEFORE INSERT trigger, migration 0042) -- this is a
      // placeholder, same convention as receta-repository.ts's
      // insertRecetaConItems (numeroInterno: 0).
      numero: BigInt(0),
      periodoDesde: new Date(`${input.periodoDesde}T00:00:00Z`),
      periodoHasta: new Date(`${input.periodoHasta}T00:00:00Z`),
      ubicacion: input.ubicacion,
      incluyeControladas: input.incluyeControladas,
      registradoPorId: input.registradoPorId,
    },
    select: { id: true, numero: true },
  });
  return { id: lote.id, numero: lote.numero.toString() };
}

export async function asignarRecetasALote(tx: Prisma.TransactionClient, tenantId: string, loteId: string, recetaIds: string[]): Promise<void> {
  if (recetaIds.length === 0) return;
  await tx.receta.updateMany({
    where: { tenantId, id: { in: recetaIds } },
    data: { loteArchivoId: loteId },
  });
}

// ============================================================================
// /archivo listado + detalle.
// ============================================================================

export interface ListLotesFilter {
  tenantId: string;
  estado?: EstadoLoteArchivoValue;
  periodoDesde?: string;
  periodoHasta?: string;
  page: number;
  pageSize: number;
}

export interface LoteRow {
  id: string;
  numero: string;
  periodoDesde: string;
  periodoHasta: string;
  ubicacion: string;
  incluyeControladas: boolean;
  estado: EstadoLoteArchivoValue;
  registradoEn: Date;
  /** Computed in SQL by `fetchVencimientos` -- see module doc comment. */
  vencimiento: string;
  plazoCumplido: boolean;
}

export async function listLotes(tx: Prisma.TransactionClient, filter: ListLotesFilter): Promise<{ items: LoteRow[]; total: number }> {
  const where: Prisma.LoteArchivoRecetasWhereInput = {
    tenantId: filter.tenantId,
    ...(filter.estado ? { estado: filter.estado } : {}),
    ...(filter.periodoDesde ? { periodoHasta: { gte: new Date(`${filter.periodoDesde}T00:00:00Z`) } } : {}),
    ...(filter.periodoHasta ? { periodoDesde: { lte: new Date(`${filter.periodoHasta}T00:00:00Z`) } } : {}),
  };
  const skip = (filter.page - 1) * filter.pageSize;

  const [total, rows, plazos] = await Promise.all([
    tx.loteArchivoRecetas.count({ where }),
    tx.loteArchivoRecetas.findMany({
      where,
      orderBy: [{ numero: "desc" }],
      skip,
      take: filter.pageSize,
      select: { id: true, numero: true, periodoDesde: true, periodoHasta: true, ubicacion: true, incluyeControladas: true, estado: true, registradoEn: true },
    }),
    getPlazosArchivo(tx, filter.tenantId),
  ]);

  const vencimientos = await fetchVencimientos(tx, filter.tenantId, rows.map((r) => r.id), plazos);

  return {
    total,
    items: rows.map((r) => {
      const v = vencimientos.get(r.id);
      if (!v) throw new Error(`listLotes: no vencimiento computed for lote ${r.id}`);
      return {
        id: r.id,
        numero: r.numero.toString(),
        periodoDesde: r.periodoDesde.toISOString().slice(0, 10),
        periodoHasta: r.periodoHasta.toISOString().slice(0, 10),
        ubicacion: r.ubicacion,
        incluyeControladas: r.incluyeControladas,
        estado: r.estado as EstadoLoteArchivoValue,
        registradoEn: r.registradoEn,
        vencimiento: v.vencimiento,
        plazoCumplido: v.plazoCumplido,
      };
    }),
  };
}

export interface LoteDetalle extends LoteRow {
  expedienteAutorizacion: string | null;
  fechaAutorizacion: string | null;
  fechaDestruccion: string | null;
  registradoPorNombre: string;
  registradoPorApellido: string;
  recetas: { id: string; numeroInterno: string; pacienteNombre: string; pacienteApellido: string; estado: string }[];
}

export async function getLoteDetalle(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<LoteDetalle | null> {
  const lote = await tx.loteArchivoRecetas.findUnique({
    where: { id, tenantId },
    select: {
      id: true,
      numero: true,
      periodoDesde: true,
      periodoHasta: true,
      ubicacion: true,
      incluyeControladas: true,
      estado: true,
      registradoEn: true,
      expedienteAutorizacion: true,
      fechaAutorizacion: true,
      fechaDestruccion: true,
      registradoPor: { select: { nombre: true, apellido: true } },
      recetas: { select: { id: true, numeroInterno: true, estado: true, paciente: { select: { nombre: true, apellido: true } } } },
    },
  });
  if (!lote) return null;

  const plazos = await getPlazosArchivo(tx, tenantId);
  const vencimientos = await fetchVencimientos(tx, tenantId, [lote.id], plazos);
  const v = vencimientos.get(lote.id);
  if (!v) throw new Error(`getLoteDetalle: no vencimiento computed for lote ${lote.id}`);

  return {
    id: lote.id,
    numero: lote.numero.toString(),
    periodoDesde: lote.periodoDesde.toISOString().slice(0, 10),
    periodoHasta: lote.periodoHasta.toISOString().slice(0, 10),
    ubicacion: lote.ubicacion,
    incluyeControladas: lote.incluyeControladas,
    estado: lote.estado as EstadoLoteArchivoValue,
    registradoEn: lote.registradoEn,
    vencimiento: v.vencimiento,
    plazoCumplido: v.plazoCumplido,
    expedienteAutorizacion: lote.expedienteAutorizacion,
    fechaAutorizacion: lote.fechaAutorizacion ? lote.fechaAutorizacion.toISOString().slice(0, 10) : null,
    fechaDestruccion: lote.fechaDestruccion ? lote.fechaDestruccion.toISOString().slice(0, 10) : null,
    registradoPorNombre: lote.registradoPor.nombre,
    registradoPorApellido: lote.registradoPor.apellido,
    recetas: lote.recetas.map((r) => ({
      id: r.id,
      numeroInterno: r.numeroInterno.toString(),
      pacienteNombre: r.paciente.nombre,
      pacienteApellido: r.paciente.apellido,
      estado: r.estado,
    })),
  };
}

// ============================================================================
// 12.3: destrucción -- lock/read + the 3 state transitions.
// ============================================================================

export interface LoteParaAccion {
  id: string;
  estado: EstadoLoteArchivoValue;
  expedienteAutorizacion: string | null;
  fechaAutorizacion: string | null;
}

/** `SELECT ... FOR UPDATE` -- `fsj.lote_archivo_recetas` has an UPDATE grant on `estado`/`expediente_autorizacion`/`fecha_autorizacion`/`fecha_destruccion` (migration 0016), so `fsj_app` CAN lock this row (this task's own gotcha note, verified). */
export async function lockLoteParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<LoteParaAccion | null> {
  const rows = await tx.$queryRaw<{ id: string; estado: EstadoLoteArchivoValue; expediente_autorizacion: string | null; fecha_autorizacion: string | null }[]>`
    SELECT id, estado, expediente_autorizacion, fecha_autorizacion::text AS fecha_autorizacion
    FROM fsj.lote_archivo_recetas
    WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, estado: row.estado, expedienteAutorizacion: row.expediente_autorizacion, fechaAutorizacion: row.fecha_autorizacion };
}

export async function solicitarDestruccionDb(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<void> {
  await tx.loteArchivoRecetas.update({ where: { id, tenantId }, data: { estado: "DESTRUCCION_SOLICITADA" } });
}

export async function autorizarDestruccionDb(tx: Prisma.TransactionClient, tenantId: string, id: string, input: { expedienteAutorizacion: string; fechaAutorizacion: string }): Promise<void> {
  await tx.loteArchivoRecetas.update({
    where: { id, tenantId },
    data: { estado: "DESTRUCCION_AUTORIZADA", expedienteAutorizacion: input.expedienteAutorizacion, fechaAutorizacion: new Date(`${input.fechaAutorizacion}T00:00:00Z`) },
  });
}

export async function registrarDestruccionDb(tx: Prisma.TransactionClient, tenantId: string, id: string, input: { fechaDestruccion: string }): Promise<void> {
  await tx.loteArchivoRecetas.update({
    where: { id, tenantId },
    data: { estado: "DESTRUIDO", fechaDestruccion: new Date(`${input.fechaDestruccion}T00:00:00Z`) },
  });
}

// ============================================================================
// 12.2: job de plazos + banner de destrucción pendiente.
// ============================================================================

/**
 * Every active tenant (`fecha_baja IS NULL`) -- FASE 12 point 12.2's daily
 * job iterates this list. Runs inside `withPlatformTransaction` (no
 * `app.tenant_id` set): `fsj.tenant` is one of the few genuinely global
 * tables (plan §10), visible without RLS tenant scoping.
 */
export async function listActiveTenantIds(tx: Prisma.TransactionClient): Promise<string[]> {
  const rows = await tx.tenant.findMany({ where: { fechaBaja: null }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Cheap aggregate for the layout banner (archivo.destruccion.gestionar) -- same "count only, no full list" discipline as `modules/cierres/infrastructure/cierre-repository.ts#getResumenPendientes`. */
export async function getResumenDestruccion(tx: Prisma.TransactionClient, tenantId: string): Promise<{ cantidad: number }> {
  const cantidad = await tx.loteArchivoRecetas.count({ where: { tenantId, estado: "PLAZO_CUMPLIDO" } });
  return { cantidad };
}

/** The tenant's SISTEMA usuario (seeded per-tenant by scripts/create-tenant.ts, `es_tecnico = true`) -- the actor recorded on the job's automatic audit rows (task's explicit rule). */
export async function getSistemaUsuarioId(tx: Prisma.TransactionClient, tenantId: string): Promise<string | null> {
  const row = await tx.usuario.findFirst({ where: { tenantId, esTecnico: true }, select: { id: true } });
  return row?.id ?? null;
}

export interface LoteMovidoAPlazoCumplido {
  id: string;
  numero: string;
}

/**
 * Shared core of FASE 12 point 12.2 -- moves every `EN_ARCHIVO` lote whose
 * `vencimiento` (`periodo_hasta + N años`, N per `incluye_controladas`) is
 * `<= fsj.jornada_actual(tenant)` to `PLAZO_CUMPLIDO`, in ONE SQL statement
 * (`UPDATE ... RETURNING`), then audits each moved row individually with
 * the given `actorId`/`motivo` -- called by BOTH the daily job route
 * handler (SISTEMA actor, no `authorize()`) and the DT's "Actualizar
 * plazos" button (`application/actualizar-plazos.ts`'s `defineCommand`,
 * DT actor). Idempotent: re-running only ever matches `EN_ARCHIVO` rows, so
 * a lote already moved is never touched again.
 */
export async function moverPlazoCumplidoTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  actorId: string,
  motivo: string,
): Promise<LoteMovidoAPlazoCumplido[]> {
  const plazos = await getPlazosArchivo(tx, tenantId);
  const rows = await tx.$queryRaw<{ id: string; numero: bigint; periodo_hasta: Date; incluye_controladas: boolean }[]>`
    UPDATE fsj.lote_archivo_recetas l
    SET estado = 'PLAZO_CUMPLIDO'
    WHERE l.tenant_id = ${tenantId}::uuid
      AND l.estado = 'EN_ARCHIVO'
      AND fsj.jornada_actual(l.tenant_id) >= ${vencimientoFragment(plazos)}
    RETURNING l.id, l.numero, l.periodo_hasta, l.incluye_controladas
  `;

  for (const row of rows) {
    await auditRecord(tx, {
      tenantId,
      usuarioId: actorId,
      entidad: "lote_archivo_recetas",
      entidadId: row.id,
      accion: TipoAccion.CAMBIAR_ESTADO,
      valorAnterior: { estado: "EN_ARCHIVO" },
      valorNuevo: { estado: "PLAZO_CUMPLIDO" },
      motivo,
    });
  }

  return rows.map((r) => ({ id: r.id, numero: r.numero.toString() }));
}
