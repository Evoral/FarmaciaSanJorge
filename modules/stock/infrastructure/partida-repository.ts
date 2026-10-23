/**
 * Prisma-backed access to `fsj.partida` / `fsj.movimiento_stock` /
 * `fsj.v_stock_droga` for M07 (FASE 5). Every function runs inside an
 * ALREADY OPEN tenant transaction (`tx`, handed in by `shared/usecase.ts`)
 * -- nothing here opens its own transaction. `tenantId` is an explicit,
 * defense-in-depth filter on top of RLS everywhere (same discipline as
 * every other repository in this codebase -- see
 * modules/proveedores/infrastructure/proveedor-repository.ts).
 *
 * "NO HACER" (plan §9 M07): stock is NEVER summed in application code --
 * every stock read here goes through `fsj.v_stock_droga`.
 */
import { Prisma } from "@/generated/prisma/client";
import type { TipoMovimiento, MotivoAjuste as PrismaMotivoAjuste } from "@/generated/prisma/enums";
import { DIAS_ALERTA_VENCIMIENTO_PARTIDA_DEFAULT, type OrdenStockDrogas } from "../domain/partida";
import { rangoDeJornadas } from "@/shared/time/jornada";
import { drogaCoincideSql, sinonimoCoincidenteSql } from "@/shared/db/busqueda-droga";
import { ETIQUETA_SIN_PROVEEDOR } from "@/shared/labels/enum-labels";

// ============================================================================
// jornada helper (fsj.jornada_actual(tenantId)) -- see migration 0014.
// Every business-date decision in this module (vencimiento futuro, ventana
// de alerta, vencidas) goes through this, never `new Date()`.
// ============================================================================
export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

// ============================================================================
// 5.2: stock por droga (fsj.v_stock_droga -- NEVER summed in JS)
// ============================================================================

export interface StockDrogaItem {
  drogaId: string;
  drogaNombre: string;
  unidadId: string;
  unidadSimbolo: string;
  stockMinimo: string;
  stockDisponible: string;
  /** `stock_disponible < stock_minimo`, compared in SQL (numeric). */
  bajoMinimo: boolean;
  /** Earliest vencimiento VIGENTE (`fecha_vencimiento_vigente`, migration 0074) among partidas with balance (YYYY-MM-DD), `null` when none has balance. */
  proximoVencimiento: string | null;
  /** The synonym the search matched through, when the name itself did not match (docs/specs/sinonimos-droga.md). */
  sinonimoCoincidente: string | null;
}

export interface ListStockDrogasFilter {
  tenantId: string;
  search?: string;
  soloBajoMinimo?: boolean;
  /** stock disponible = 0. */
  soloSinStock?: boolean;
  /** Has a partida with balance expiring within `[jornada, jornada + diasAlertaVencimiento]` (same window as `alertasPorVencer`). */
  conPartidasPorVencer?: boolean;
  /** Has an already-expired partida that still carries balance (same rule as `alertasVencidasConSaldo`). */
  conPartidasVencidas?: boolean;
  soloControladas?: boolean;
  /** Required when `conPartidasPorVencer` -- see `getDiasAlertaVencimiento`. */
  diasAlertaVencimiento: number;
  orden?: OrdenStockDrogas;
  page: number;
  pageSize: number;
}

export interface ListStockDrogasResult {
  items: StockDrogaItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Joins `fsj.droga` (vigentes only -- a baja droga has nothing left to
 * stock-manage) with `fsj.v_stock_droga` in ONE query -- the view already
 * does the SUM; this query only joins, filters, orders and paginates, ALL
 * in SQL (numeric comparisons included -- never `Number()` in JS).
 *
 * `total` comes from the same statement: `(SELECT count(*) FROM filtradas)`
 * LEFT JOINed to the page, so a page past the end still reports the real
 * total (the page side is then a single all-NULL row, dropped below).
 *
 * The "por vencer" / "vencidas con saldo" filters mirror
 * `alertasPorVencer` / `alertasVencidasConSaldo` below exactly (same
 * `fsj.jornada_actual` window): a droga is listed exactly when it has a
 * partida counted by that alert card.
 *
 * The statement itself is built by `listStockDrogasSql` so
 * tests/db/stock-drogas-filtros.test.ts runs this EXACT SQL on its raw `pg`
 * connection (Prisma cannot see that test's uncommitted rows).
 */
export async function listStockDrogas(tx: Prisma.TransactionClient, filter: ListStockDrogasFilter): Promise<ListStockDrogasResult> {
  const rows = await tx.$queryRaw<ListStockDrogasRow[]>(listStockDrogasSql(filter));

  return {
    items: rows
      .filter((row) => row.droga_id !== null)
      .map((row) => ({
        drogaId: row.droga_id!,
        drogaNombre: row.nombre!,
        unidadId: row.unidad_id!,
        unidadSimbolo: row.simbolo!,
        stockMinimo: row.stock_minimo!,
        stockDisponible: row.stock_disponible!,
        bajoMinimo: row.bajo_minimo === true,
        proximoVencimiento: row.proximo_vencimiento,
        sinonimoCoincidente: row.sinonimo,
      })),
    total: rows[0]?.total ?? 0,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

/** One row of `listStockDrogasSql`: every page column is NULL on the single row of an empty page. */
export interface ListStockDrogasRow {
  total: number;
  droga_id: string | null;
  nombre: string | null;
  unidad_id: string | null;
  simbolo: string | null;
  stock_minimo: string | null;
  stock_disponible: string | null;
  bajo_minimo: boolean | null;
  proximo_vencimiento: string | null;
  sinonimo: string | null;
}

export function listStockDrogasSql(filter: ListStockDrogasFilter): Prisma.Sql {
  const search = filter.search?.trim() || null;
  const skip = (filter.page - 1) * filter.pageSize;
  const orden = filter.orden ?? "nombre";

  return Prisma.sql`
    WITH filtradas AS (
      SELECT
        d.id AS droga_id,
        d.nombre,
        u.id AS unidad_id,
        u.simbolo,
        d.stock_minimo,
        ${sinonimoCoincidenteSql("d", search)} AS sinonimo,
        coalesce(v.stock_disponible, 0) AS stock_disponible,
        coalesce(v.stock_disponible, 0) * u.factor_a_base AS stock_en_base,
        (
          SELECT min(p.fecha_vencimiento_vigente)
          FROM fsj.partida p
          WHERE p.tenant_id = d.tenant_id AND p.droga_id = d.id AND p.cantidad_disponible > 0
        ) AS proximo_vencimiento
      FROM fsj.droga d
      JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
      LEFT JOIN fsj.v_stock_droga v ON v.tenant_id = d.tenant_id AND v.droga_id = d.id
      WHERE d.tenant_id = ${filter.tenantId}::uuid
        AND d.fecha_baja IS NULL
        AND ${drogaCoincideSql("d", search)}
        AND (NOT ${filter.soloControladas ?? false}::boolean OR d.es_controlada)
        AND (NOT ${filter.soloBajoMinimo ?? false}::boolean OR coalesce(v.stock_disponible, 0) < d.stock_minimo)
        AND (NOT ${filter.soloSinStock ?? false}::boolean OR coalesce(v.stock_disponible, 0) = 0)
        AND (
          NOT ${filter.conPartidasPorVencer ?? false}::boolean
          OR EXISTS (
            SELECT 1
            FROM fsj.partida p
            WHERE p.tenant_id = d.tenant_id
              AND p.droga_id = d.id
              AND p.cantidad_disponible > 0
              AND p.fecha_vencimiento_vigente >= fsj.jornada_actual(${filter.tenantId}::uuid)
              AND p.fecha_vencimiento_vigente <= (fsj.jornada_actual(${filter.tenantId}::uuid) + (${filter.diasAlertaVencimiento}::int || ' days')::interval)
          )
        )
        AND (
          NOT ${filter.conPartidasVencidas ?? false}::boolean
          OR EXISTS (
            SELECT 1
            FROM fsj.partida p
            WHERE p.tenant_id = d.tenant_id
              AND p.droga_id = d.id
              AND p.cantidad_disponible > 0
              AND p.fecha_vencimiento_vigente < fsj.jornada_actual(${filter.tenantId}::uuid)
          )
        )
    )
    SELECT
      t.total,
      f.droga_id,
      f.nombre,
      f.unidad_id,
      f.simbolo,
      f.stock_minimo::text AS stock_minimo,
      f.stock_disponible::text AS stock_disponible,
      f.stock_disponible < f.stock_minimo AS bajo_minimo,
      f.proximo_vencimiento::text AS proximo_vencimiento,
      f.sinonimo
    FROM (SELECT count(*)::int AS total FROM filtradas) t
    LEFT JOIN LATERAL (
      SELECT *
      FROM filtradas
      ORDER BY
        CASE WHEN ${orden}::text = 'stock' THEN stock_en_base END ASC,
        CASE WHEN ${orden}::text = 'vencimiento' THEN proximo_vencimiento END ASC NULLS LAST,
        nombre ASC,
        droga_id ASC
      LIMIT ${filter.pageSize}::int OFFSET ${skip}::int
    ) f ON true
  `;
}

// ============================================================================
// 5.2: partidas de una droga, con saldo
// ============================================================================

export interface PartidaListItem {
  id: string;
  lote: string;
  proveedorId: string | null;
  proveedorRazonSocial: string;
  costoUnitario: string;
  cantidadInicial: string;
  cantidadDisponible: string;
  /** Of `cantidadDisponible` (the physical saldo), what preparaciones INICIADA reserved (migration 0071); informational. */
  cantidadReservada: string;
  fechaIngreso: Date;
  /** The ORIGINAL expiry printed on the lot; `null` = does not expire (migration 0064). */
  fechaVencimiento: Date | null;
  /** The vencimiento VIGENTE (migration 0074): the latest reanálisis, else `fechaVencimiento`. Every expiry decision uses this one. */
  fechaVencimientoVigente: Date | null;
  fechaApertura: Date | null;
}

export interface ListPartidasDrogaFilter {
  tenantId: string;
  drogaId: string;
  soloConSaldo?: boolean;
  soloVencidas?: boolean;
  page: number;
  pageSize: number;
}

export interface ListPartidasDrogaResult {
  /** The droga the partidas belong to (its quantities are all in its unidad base); `null` if it does not exist in this tenant. */
  droga: { nombre: string; unidadBaseId: string; unidadBaseSimbolo: string; clase: string } | null;
  items: PartidaListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listPartidasDeDroga(tx: Prisma.TransactionClient, filter: ListPartidasDrogaFilter): Promise<ListPartidasDrogaResult> {
  const where: Prisma.PartidaWhereInput = { tenantId: filter.tenantId, drogaId: filter.drogaId };
  if (filter.soloConSaldo) where.cantidadDisponible = { gt: 0 };
  if (filter.soloVencidas) {
    const jornada = await jornadaActualTenant(tx, filter.tenantId);
    where.fechaVencimientoVigente = { lt: new Date(`${jornada}T00:00:00Z`) };
  }

  const skip = (filter.page - 1) * filter.pageSize;
  const droga = await tx.droga.findUnique({
    where: { id: filter.drogaId, tenantId: filter.tenantId },
    select: { nombre: true, unidadBaseId: true, clase: true, unidadBase: { select: { simbolo: true } } },
  });
  const total = await tx.partida.count({ where });
  const rows = await tx.partida.findMany({
    where,
    orderBy: [{ fechaVencimientoVigente: "asc" }],
    skip,
    take: filter.pageSize,
    select: {
      id: true,
      lote: true,
      proveedorId: true,
      costoUnitario: true,
      cantidadInicial: true,
      cantidadDisponible: true,
      fechaIngreso: true,
      fechaVencimiento: true,
      fechaVencimientoVigente: true,
      fechaApertura: true,
      proveedor: { select: { razonSocial: true } },
    },
  });

  const reservado = await reservadoPorPartida(tx, filter.tenantId, rows.map((row) => row.id));

  return {
    droga: droga ? { nombre: droga.nombre, unidadBaseId: droga.unidadBaseId, unidadBaseSimbolo: droga.unidadBase.simbolo, clase: droga.clase } : null,
    items: rows.map((row) => ({
      id: row.id,
      lote: row.lote,
      proveedorId: row.proveedorId,
      proveedorRazonSocial: row.proveedor?.razonSocial ?? ETIQUETA_SIN_PROVEEDOR,
      costoUnitario: row.costoUnitario.toString(),
      cantidadInicial: row.cantidadInicial.toString(),
      cantidadDisponible: row.cantidadDisponible.toString(),
      cantidadReservada: reservado.get(row.id) ?? "0",
      fechaIngreso: row.fechaIngreso,
      fechaVencimiento: row.fechaVencimiento,
      fechaVencimientoVigente: row.fechaVencimientoVigente,
      fechaApertura: row.fechaApertura,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

// ============================================================================
// `/partidas` (docs/specs/historial-partidas.md): every partida of the
// tenant, across all drogas (insumos included: they are drogas with another
// `clase`), newest ingreso first. Agotadas included unless `soloConSaldo`.
// ============================================================================

export interface PartidaHistorialItem {
  id: string;
  lote: string;
  drogaId: string;
  drogaNombre: string;
  /** The droga unidad base -- every quantity of the partida is recorded in it. */
  unidadBaseId: string;
  unidadBaseSimbolo: string;
  proveedorId: string | null;
  proveedorRazonSocial: string;
  cantidadInicial: string;
  cantidadDisponible: string;
  fechaIngreso: Date;
  /** The ORIGINAL expiry printed on the lot; `null` = does not expire (migration 0064). */
  fechaVencimiento: Date | null;
  /** The vencimiento VIGENTE (migration 0074). Every expiry decision uses this one. */
  fechaVencimientoVigente: Date | null;
  fechaApertura: Date | null;
}

export interface ListPartidasHistorialFilter {
  tenantId: string;
  drogaId?: string;
  proveedorId?: string;
  /** Case-insensitive "contains" on the lote. */
  lote?: string;
  /** YYYY-MM-DD jornada in the tenant's time zone (inclusive) -- `fecha_ingreso` is a timestamptz. */
  desde?: string;
  hasta?: string;
  soloConSaldo?: boolean;
  soloVencidas?: boolean;
  page: number;
  pageSize: number;
}

export interface ListPartidasHistorialResult {
  items: PartidaHistorialItem[];
  total: number;
  page: number;
  pageSize: number;
  /** For showing `fechaIngreso` as the farmacia's calendar day. */
  zonaHoraria: string;
  /** The filtered droga's name (for the autocomplete), `null` without a droga filter or when it does not exist in this tenant. */
  droga: { id: string; nombre: string } | null;
  /** Every proveedor that has at least one partida of this tenant (dados de baja included: it is a history), by razón social. */
  proveedores: { id: string; razonSocial: string }[];
}

export async function listPartidasHistorial(tx: Prisma.TransactionClient, filter: ListPartidasHistorialFilter): Promise<ListPartidasHistorialResult> {
  const zonaHoraria = await getZonaHorariaTenant(tx, filter.tenantId);
  const where: Prisma.PartidaWhereInput = { tenantId: filter.tenantId };
  if (filter.drogaId) where.drogaId = filter.drogaId;
  if (filter.proveedorId) where.proveedorId = filter.proveedorId;
  if (filter.lote) where.lote = { contains: filter.lote, mode: "insensitive" };
  if (filter.soloConSaldo) where.cantidadDisponible = { gt: 0 };
  if (filter.soloVencidas) {
    const jornada = await jornadaActualTenant(tx, filter.tenantId);
    where.fechaVencimientoVigente = { lt: new Date(`${jornada}T00:00:00Z`) };
  }
  if (filter.desde || filter.hasta) {
    // Calendar days in the pharmacy's time zone, not UTC (same rule as the kardex).
    const { desde, hastaExclusivo } = rangoDeJornadas(filter.desde, filter.hasta, zonaHoraria);
    where.fechaIngreso = {
      ...(desde ? { gte: desde } : {}),
      ...(hastaExclusivo ? { lt: hastaExclusivo } : {}),
    };
  }

  const skip = (filter.page - 1) * filter.pageSize;
  const total = await tx.partida.count({ where });
  const rows = await tx.partida.findMany({
    where,
    orderBy: [{ fechaIngreso: "desc" }, { id: "desc" }],
    skip,
    take: filter.pageSize,
    select: {
      id: true,
      lote: true,
      drogaId: true,
      proveedorId: true,
      cantidadInicial: true,
      cantidadDisponible: true,
      fechaIngreso: true,
      fechaVencimiento: true,
      fechaVencimientoVigente: true,
      fechaApertura: true,
      droga: { select: { nombre: true, unidadBaseId: true, unidadBase: { select: { simbolo: true } } } },
      proveedor: { select: { razonSocial: true } },
    },
  });
  const droga = filter.drogaId
    ? await tx.droga.findUnique({ where: { id: filter.drogaId, tenantId: filter.tenantId }, select: { id: true, nombre: true } })
    : null;
  const proveedores = await tx.proveedor.findMany({
    where: { tenantId: filter.tenantId, partidas: { some: {} } },
    orderBy: [{ razonSocial: "asc" }, { id: "asc" }],
    select: { id: true, razonSocial: true },
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      lote: row.lote,
      drogaId: row.drogaId,
      drogaNombre: row.droga.nombre,
      unidadBaseId: row.droga.unidadBaseId,
      unidadBaseSimbolo: row.droga.unidadBase.simbolo,
      proveedorId: row.proveedorId,
      proveedorRazonSocial: row.proveedor?.razonSocial ?? ETIQUETA_SIN_PROVEEDOR,
      cantidadInicial: row.cantidadInicial.toString(),
      cantidadDisponible: row.cantidadDisponible.toString(),
      fechaIngreso: row.fechaIngreso,
      fechaVencimiento: row.fechaVencimiento,
      fechaVencimientoVigente: row.fechaVencimientoVigente,
      fechaApertura: row.fechaApertura,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
    zonaHoraria,
    droga,
    proveedores,
  };
}

// ============================================================================
// Detail read + lock-before-read (M3 discipline: see
// modules/usuarios/infrastructure/admin-guard.ts's header comment -- lock
// the row in ONE statement, THEN decide from a FRESH read).
// ============================================================================

export interface PartidaParaAccion {
  id: string;
  drogaId: string;
  drogaNombre: string;
  /** `droga.clase` (migration 0063): only a DROGA partida admits a reanálisis (migration 0074). */
  drogaClase: string;
  /** The droga unidad base -- every quantity of the partida is recorded in it. */
  unidadBaseId: string;
  unidadBaseSimbolo: string;
  proveedorId: string | null;
  proveedorRazonSocial: string;
  lote: string;
  costoUnitario: string;
  cantidadInicial: string;
  cantidadDisponible: string;
  fechaIngreso: Date;
  /** The ORIGINAL expiry printed on the lot; `null` = does not expire (migration 0064). Never changes. */
  fechaVencimiento: Date | null;
  /** The vencimiento VIGENTE (migration 0074): the latest reanálisis, else `fechaVencimiento`. Every expiry decision uses this one. */
  fechaVencimientoVigente: Date | null;
  fechaApertura: Date | null;
  /** Migration 0058: declared purity (percent), `null` = 100%. */
  potenciaDeclarada: string | null;
  /** Migration 0100: COMPRA or EXISTENCIA_INICIAL (docs/specs/existencia-inicial.md R10). */
  origen: "COMPRA" | "EXISTENCIA_INICIAL";
}

export async function getPartidaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PartidaParaAccion | null> {
  const row = await tx.partida.findUnique({
    where: { id, tenantId },
    select: {
      id: true,
      drogaId: true,
      proveedorId: true,
      lote: true,
      costoUnitario: true,
      cantidadInicial: true,
      cantidadDisponible: true,
      fechaIngreso: true,
      fechaVencimiento: true,
      fechaVencimientoVigente: true,
      fechaApertura: true,
      potenciaDeclarada: true,
      origen: true,
      droga: { select: { nombre: true, clase: true, unidadBaseId: true, unidadBase: { select: { simbolo: true } } } },
      proveedor: { select: { razonSocial: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    drogaId: row.drogaId,
    drogaNombre: row.droga.nombre,
    drogaClase: row.droga.clase,
    unidadBaseId: row.droga.unidadBaseId,
    unidadBaseSimbolo: row.droga.unidadBase.simbolo,
    proveedorId: row.proveedorId,
    proveedorRazonSocial: row.proveedor?.razonSocial ?? ETIQUETA_SIN_PROVEEDOR,
    lote: row.lote,
    costoUnitario: row.costoUnitario.toString(),
    cantidadInicial: row.cantidadInicial.toString(),
    cantidadDisponible: row.cantidadDisponible.toString(),
    fechaIngreso: row.fechaIngreso,
    fechaVencimiento: row.fechaVencimiento,
    fechaVencimientoVigente: row.fechaVencimientoVigente,
    fechaApertura: row.fechaApertura,
    potenciaDeclarada: row.potenciaDeclarada?.toString() ?? null,
    origen: row.origen,
  };
}

/**
 * Locks the target partida row (`SELECT ... FOR UPDATE`) BEFORE any caller
 * reads its current balance -- same discipline as
 * `modules/proveedores/infrastructure/proveedor-repository.ts#lockProveedorParaAccion`.
 * Every write in this module that decides something FROM the partida's
 * current state (ajuste's saldo check, corregir-costo's optimistic version)
 * calls this FIRST, then re-reads via `getPartidaParaAccion` -- a FRESH
 * statement, not the locked snapshot's own columns -- so two concurrent
 * ajustes on the same partida serialize instead of both reading stale
 * balance. Returns `false` when no row matches.
 */
export async function lockPartidaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.partida WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

// ============================================================================
// 5.1: ingreso de partida (partida INSERT + mandatory INGRESO_COMPRA, SAME
// transaction -- migration 0008's deferred constraint trigger,
// INV-STK-002, requires exactly this atomicity by commit time).
// ============================================================================

export interface NuevaPartidaInput {
  /** Default COMPRA (INGRESO_COMPRA). EXISTENCIA_INICIAL writes INGRESO_INICIAL (migration 0100, INV-S25). */
  origen?: "COMPRA" | "EXISTENCIA_INICIAL";
  tenantId: string;
  drogaId: string;
  proveedorId: string | null;
  lote: string;
  costoUnitario: string;
  /** Already converted to the droga's unidad base -- see ingresar-partida.ts. */
  cantidadInicialBase: string;
  /** YYYY-MM-DD; `null` = does not expire -- an insumo only (migration 0064). */
  fechaVencimiento: string | null;
  registradoPorId: string;
  numeroValeAdquisicion: string | null;
  /** Migration 0058: the lot's purity (%), `null` = 100%. */
  potenciaDeclarada: string | null;
  /** Migration 0062: set only by the invoice import (`null` for a manual alta). */
  comprobanteCompraId?: string | null;
  despachoImportacion?: string | null;
  paisOrigen?: string | null;
}

/** `uq (tenant, droga, proveedor, lote)` pre-check, for a clear message on the lote field instead of a generic unique violation. */
/** `proveedorId` null = among the partidas without proveedor (uq_partida_lote_sin_proveedor, migration 0100). */
export async function existePartidaLote(tx: Prisma.TransactionClient, tenantId: string, drogaId: string, proveedorId: string | null, lote: string): Promise<boolean> {
  const row = await tx.partida.findFirst({ where: { tenantId, drogaId, proveedorId, lote }, select: { id: true } });
  return row !== null;
}

/** Reads what `ingresar-partida.ts` needs to decide unit conversion + INV-L16 (numero_vale_adquisicion), in one round trip. */
export interface DrogaParaIngreso {
  id: string;
  nombre: string;
  unidadBaseId: string;
  tipoControl: string;
  /** Migration 0063: only a DROGA requires fecha_vencimiento (0064). */
  clase: string;
  fechaBaja: Date | null;
}

export async function getDrogaParaIngreso(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<DrogaParaIngreso | null> {
  const row = await tx.droga.findUnique({
    where: { id: drogaId, tenantId },
    select: { id: true, nombre: true, unidadBaseId: true, tipoControl: true, clase: true, fechaBaja: true },
  });
  return row;
}

export interface ProveedorParaIngreso {
  id: string;
  razonSocial: string;
  fechaBaja: Date | null;
}

export async function getProveedorParaIngreso(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string): Promise<ProveedorParaIngreso | null> {
  return tx.proveedor.findUnique({ where: { id: proveedorId, tenantId }, select: { id: true, razonSocial: true, fechaBaja: true } });
}

/** "gramo (g)" -- readable unidad name for audit rows (global catalog, DP-39). `null` if it does not exist. */
export async function getEtiquetaUnidad(tx: Prisma.TransactionClient, unidadId: string): Promise<string | null> {
  const unidad = await tx.unidadMedida.findUnique({ where: { id: unidadId }, select: { nombre: true, simbolo: true } });
  return unidad ? `${unidad.nombre} (${unidad.simbolo})` : null;
}

/** What `ingresar-partida.ts` / `registrar-ajuste.ts` check about a unit BEFORE `fsj.convertir` (clear Spanish messages instead of INV-M01's). */
export interface UnidadParaConversion {
  id: string;
  codigo: string;
  simbolo: string;
  tipoMagnitud: string;
  fechaBaja: Date | null;
}

/** unidad id -> its row, for the given ids (global catalog, DP-39: no tenant filter; bajas included). Missing ids are absent from the map. */
export async function getUnidadesParaConversion(tx: Prisma.TransactionClient, unidadIds: readonly string[]): Promise<Map<string, UnidadParaConversion>> {
  const rows = await tx.unidadMedida.findMany({
    where: { id: { in: [...new Set(unidadIds)] } },
    select: { id: true, codigo: true, simbolo: true, tipoMagnitud: true, fechaBaja: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/** `fsj.convertir(valor, origen, destino)` -- INV-M01. Never converts across `tipo_magnitud` (raises INV-M01, mapped by `mapDbError`). */
export async function convertirUnidad(tx: Prisma.TransactionClient, valor: string, unidadOrigenId: string, unidadDestinoId: string): Promise<string> {
  if (unidadOrigenId === unidadDestinoId) return valor;
  const rows = await tx.$queryRaw<{ resultado: string }[]>`
    SELECT fsj.convertir(${valor}::numeric, ${unidadOrigenId}::uuid, ${unidadDestinoId}::uuid)::text AS resultado
  `;
  if (!rows[0]) throw new Error("convertirUnidad: fsj.convertir returned no row");
  return rows[0].resultado;
}

/** `tenant.fecha_activacion_contralor` -- INV-L16 pre-check (mirrors migration 0014's `movimiento_stock_validar_vale` trigger). */
export async function getFechaActivacionContralor(tx: Prisma.TransactionClient, tenantId: string): Promise<Date | null> {
  const row = await tx.tenant.findUnique({ where: { id: tenantId }, select: { fechaActivacionContralor: true } });
  return row?.fechaActivacionContralor ?? null;
}

/**
 * INSERT partida (cantidad_disponible defaults to 0 -- the trigger raises
 * it) + its mandatory INGRESO_COMPRA, in the SAME transaction. Two
 * statements, not a single CTE, because Prisma's `create` is the simplest
 * way to get back the generated id -- migration 0008's DEFERRED constraint
 * trigger (`trg_partida_ingreso_compra_obligatorio`) is what actually makes
 * this atomic by COMMIT time (both succeed, or the whole transaction rolls
 * back), not the ordering of these two statements.
 */
export async function insertPartidaConIngreso(tx: Prisma.TransactionClient, input: NuevaPartidaInput): Promise<{ id: string }> {
  const partida = await tx.partida.create({
    data: {
      tenantId: input.tenantId,
      drogaId: input.drogaId,
      proveedorId: input.proveedorId,
      lote: input.lote,
      costoUnitario: input.costoUnitario,
      cantidadInicial: input.cantidadInicialBase,
      fechaVencimiento: input.fechaVencimiento ? new Date(`${input.fechaVencimiento}T00:00:00Z`) : null,
      potenciaDeclarada: input.potenciaDeclarada,
      comprobanteCompraId: input.comprobanteCompraId ?? null,
      despachoImportacion: input.despachoImportacion ?? null,
      paisOrigen: input.paisOrigen ?? null,
      origen: input.origen ?? "COMPRA",
    },
    select: { id: true },
  });

  await tx.movimientoStock.create({
    data: {
      tenantId: input.tenantId,
      partidaId: partida.id,
      tipo: (input.origen === "EXISTENCIA_INICIAL" ? "INGRESO_INICIAL" : "INGRESO_COMPRA") as TipoMovimiento,
      cantidad: input.cantidadInicialBase,
      registradoPorId: input.registradoPorId,
      numeroValeAdquisicion: input.numeroValeAdquisicion ?? undefined,
    },
  });

  return partida;
}

// ============================================================================
// 5.4: ajustes/mermas (AJUSTE movement -- DP-21b, always subtracts).
// `autorizadoPorId` is ALWAYS the id returned by `verificarCoFirmaDt`,
// never client input trusted at face value -- see verificar-co-firma-dt.ts.
// ============================================================================

export interface NuevoAjusteInput {
  tenantId: string;
  partidaId: string;
  cantidad: string;
  motivoAjuste: PrismaMotivoAjuste;
  observacion: string;
  registradoPorId: string;
  autorizadoPorId: string;
  /** A pérdida registered during a preparación (docs/specs/reserva-stock-preparacion.md): `movimiento_stock.preparacion_id` (nullable, FK since 0013). */
  preparacionId?: string | null;
}

export async function insertAjuste(tx: Prisma.TransactionClient, input: NuevoAjusteInput): Promise<{ id: string }> {
  return tx.movimientoStock.create({
    data: {
      tenantId: input.tenantId,
      partidaId: input.partidaId,
      tipo: "AJUSTE" as TipoMovimiento,
      cantidad: input.cantidad,
      motivoAjuste: input.motivoAjuste,
      observacion: input.observacion,
      registradoPorId: input.registradoPorId,
      autorizadoPorId: input.autorizadoPorId,
      preparacionId: input.preparacionId ?? null,
    },
    select: { id: true },
  });
}

/**
 * What preparaciones INICIADA reserved from each of `partidaIds` (fsj.reserva_stock, migration 0071), for listings:
 * ONE grouped query per page; partidas without reserva are absent (= 0). Same rule as `getReservadoEnPreparacion`.
 */
export async function reservadoPorPartida(tx: Prisma.TransactionClient, tenantId: string, partidaIds: readonly string[]): Promise<Map<string, string>> {
  if (partidaIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ partida_id: string; cantidad: string }[]>`
    SELECT rs.partida_id, sum(rs.cantidad)::text AS cantidad
    FROM fsj.reserva_stock rs
    JOIN fsj.preparacion p ON p.tenant_id = rs.tenant_id AND p.id = rs.preparacion_id AND p.estado = 'INICIADA'
    WHERE rs.tenant_id = ${tenantId}::uuid AND rs.partida_id = ANY(${[...partidaIds]}::uuid[]) AND rs.cantidad > 0
    GROUP BY rs.partida_id
  `;
  return new Map(rows.map((r) => [r.partida_id, r.cantidad]));
}

/**
 * Stock of `partidaId` reserved by preparaciones INICIADA (fsj.reserva_stock, migration 0071,
 * docs/specs/reserva-stock-preparacion.md), except `excluirPreparacionId`'s own, plus the receta Nº of each of them.
 * Own small read of the preparaciones tables (each module keeps its own cross-module reads, like
 * modules/preparaciones/infrastructure/preparacion-repository.ts does).
 * Read AFTER `lockPartidaParaAccion`: a reserva is written only under the same partida lock.
 */
export async function getReservadoEnPreparacion(
  tx: Prisma.TransactionClient,
  tenantId: string,
  partidaId: string,
  excluirPreparacionId: string | null = null,
): Promise<{ cantidad: string; recetas: string[] }> {
  const rows = await tx.$queryRaw<{ cantidad: string; recetas: string[] | null }[]>`
    SELECT coalesce(sum(rs.cantidad), 0)::text AS cantidad, array_agg(DISTINCT r.numero_interno::text) AS recetas
    FROM fsj.reserva_stock rs
    JOIN fsj.preparacion p ON p.tenant_id = rs.tenant_id AND p.id = rs.preparacion_id AND p.estado = 'INICIADA'
    JOIN fsj.item_receta ir ON ir.tenant_id = p.tenant_id AND ir.id = p.item_receta_id
    JOIN fsj.receta r ON r.tenant_id = ir.tenant_id AND r.id = ir.receta_id
    WHERE rs.tenant_id = ${tenantId}::uuid AND rs.partida_id = ${partidaId}::uuid AND rs.cantidad > 0
      AND rs.preparacion_id IS DISTINCT FROM ${excluirPreparacionId}::uuid
  `;
  return { cantidad: rows[0]?.cantidad ?? "0", recetas: (rows[0]?.recetas ?? []).sort() };
}

// ============================================================================
// 5.5: corrección de costo (DT o ADM, motivo, auditado; no altera cálculos
// históricos -- costo_unitario is not referenced by any historical
// snapshot). `fsj_app` has UPDATE grant on this ONE column (migration
// 0008) -- optimistic concurrency via the old value, same shape as
// `modules/proveedores/infrastructure/proveedor-repository.ts#updateProveedorDatos`.
// ============================================================================

export interface CorregirCostoInput {
  tenantId: string;
  id: string;
  costoUnitarioNuevo: string;
  costoUnitarioAnterior: string;
}

export async function updateCostoPartida(tx: Prisma.TransactionClient, input: CorregirCostoInput): Promise<boolean> {
  const result = await tx.partida.updateMany({
    where: { id: input.id, tenantId: input.tenantId, costoUnitario: input.costoUnitarioAnterior },
    data: { costoUnitario: input.costoUnitarioNuevo },
  });
  return result.count === 1;
}

// ============================================================================
// 5.2: kardex de movimientos (filtros + paginación)
// ============================================================================

export interface KardexItem {
  id: string;
  partidaId: string;
  drogaNombre: string;
  /** The droga unidad base (`cantidad` is recorded in it). */
  unidadId: string;
  unidadSimbolo: string;
  lote: string;
  tipo: TipoMovimiento;
  cantidad: string;
  motivoAjuste: PrismaMotivoAjuste | null;
  observacion: string | null;
  registradoPorNombre: string;
  registradoPorApellido: string;
  autorizadoPorNombre: string | null;
  autorizadoPorApellido: string | null;
  registradoEn: Date;
}

export interface KardexFilter {
  tenantId: string;
  partidaId?: string;
  drogaId?: string;
  tipo?: TipoMovimiento;
  desde?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  hasta?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  page: number;
  pageSize: number;
}

export interface KardexResult {
  items: KardexItem[];
  total: number;
  page: number;
  pageSize: number;
}

async function getZonaHorariaTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  return tenant.zonaHoraria;
}

export async function kardexMovimientos(tx: Prisma.TransactionClient, filter: KardexFilter): Promise<KardexResult> {
  const where: Prisma.MovimientoStockWhereInput = { tenantId: filter.tenantId };
  if (filter.partidaId) where.partidaId = filter.partidaId;
  if (filter.drogaId) where.partida = { drogaId: filter.drogaId };
  if (filter.tipo) where.tipo = filter.tipo;
  if (filter.desde || filter.hasta) {
    // Calendar days in the pharmacy's time zone, not UTC (registrado_en is a timestamptz).
    const { desde, hastaExclusivo } = rangoDeJornadas(filter.desde, filter.hasta, await getZonaHorariaTenant(tx, filter.tenantId));
    where.registradoEn = {
      ...(desde ? { gte: desde } : {}),
      ...(hastaExclusivo ? { lt: hastaExclusivo } : {}),
    };
  }

  const skip = (filter.page - 1) * filter.pageSize;
  const total = await tx.movimientoStock.count({ where });
  const rows = await tx.movimientoStock.findMany({
    where,
    orderBy: [{ registradoEn: "desc" }],
    skip,
    take: filter.pageSize,
    select: {
      id: true,
      partidaId: true,
      tipo: true,
      cantidad: true,
      motivoAjuste: true,
      observacion: true,
      registradoEn: true,
      partida: { select: { lote: true, droga: { select: { nombre: true, unidadBaseId: true, unidadBase: { select: { simbolo: true } } } } } },
      registradoPor: { select: { nombre: true, apellido: true } },
      autorizadoPor: { select: { nombre: true, apellido: true } },
    },
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      partidaId: row.partidaId,
      drogaNombre: row.partida.droga.nombre,
      unidadId: row.partida.droga.unidadBaseId,
      unidadSimbolo: row.partida.droga.unidadBase.simbolo,
      lote: row.partida.lote,
      tipo: row.tipo,
      cantidad: row.cantidad.toString(),
      motivoAjuste: row.motivoAjuste,
      observacion: row.observacion,
      registradoPorNombre: row.registradoPor.nombre,
      registradoPorApellido: row.registradoPor.apellido,
      autorizadoPorNombre: row.autorizadoPor?.nombre ?? null,
      autorizadoPorApellido: row.autorizadoPor?.apellido ?? null,
      registradoEn: row.registradoEn,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

// ============================================================================
// `/stock/ajustes`: listado de ajustes (AJUSTE movements, newest first).
// Filters, order and pagination run in SQL. The date filter is on the
// movement's jornada -- `fsj.jornada_de(registrado_en, tenant.zona_horaria)`,
// the same business-date rule as every other legal date in this codebase --
// never on the UTC calendar day of `registrado_en`.
// ============================================================================

export interface AjusteListItem {
  id: string;
  registradoEn: Date;
  partidaId: string;
  lote: string;
  drogaId: string;
  drogaNombre: string;
  /** The droga unidad base (`cantidad` is recorded in it). */
  unidadId: string;
  unidadSimbolo: string;
  cantidad: string;
  motivoAjuste: PrismaMotivoAjuste;
  observacion: string | null;
  registradoPorNombre: string;
  registradoPorApellido: string;
  autorizadoPorNombre: string | null;
  autorizadoPorApellido: string | null;
}

export interface ListAjustesFilter {
  tenantId: string;
  /** Substring of the droga name or one of its vigente synonyms (accent-insensitive, shared/db/busqueda-droga.ts), or case-insensitive substring of the lote. */
  search?: string;
  motivoAjuste?: PrismaMotivoAjuste;
  desde?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  hasta?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  page: number;
  pageSize: number;
}

export interface ListAjustesResult {
  items: AjusteListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** The tenant's time zone, so the page shows `registradoEn` in pharmacy time (the server runs in UTC). */
  zonaHoraria: string;
}

/** One row of `listAjustesSql`: every page column is NULL on the single row of an empty page. */
export interface ListAjustesRow {
  total: number;
  zona_horaria: string;
  id: string | null;
  registrado_en: Date | null;
  partida_id: string | null;
  lote: string | null;
  droga_id: string | null;
  droga_nombre: string | null;
  unidad_id: string | null;
  unidad_simbolo: string | null;
  cantidad: string | null;
  motivo_ajuste: PrismaMotivoAjuste | null;
  observacion: string | null;
  registrado_por_nombre: string | null;
  registrado_por_apellido: string | null;
  autorizado_por_nombre: string | null;
  autorizado_por_apellido: string | null;
}

/**
 * Built separately (like `listStockDrogasSql`) so tests/db/stock-ajustes-listado.test.ts
 * runs this EXACT statement on its raw `pg` connection. Same total-plus-page
 * shape as `listStockDrogasSql`: a page past the end still reports the real total.
 */
export function listAjustesSql(filter: ListAjustesFilter): Prisma.Sql {
  const search = filter.search?.trim() || null;
  const motivo = filter.motivoAjuste ?? null;
  const desde = filter.desde ?? null;
  const hasta = filter.hasta ?? null;
  const skip = (filter.page - 1) * filter.pageSize;

  return Prisma.sql`
    WITH filtrados AS (
      SELECT
        m.id,
        m.registrado_en,
        m.partida_id,
        p.lote,
        d.id AS droga_id,
        d.nombre AS droga_nombre,
        u.id AS unidad_id,
        u.simbolo AS unidad_simbolo,
        m.cantidad,
        m.motivo_ajuste,
        m.observacion,
        r.nombre AS registrado_por_nombre,
        r.apellido AS registrado_por_apellido,
        a.nombre AS autorizado_por_nombre,
        a.apellido AS autorizado_por_apellido
      FROM fsj.movimiento_stock m
      JOIN fsj.tenant tn ON tn.id = m.tenant_id
      JOIN fsj.partida p ON p.id = m.partida_id AND p.tenant_id = m.tenant_id
      JOIN fsj.droga d ON d.id = p.droga_id AND d.tenant_id = p.tenant_id
      JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
      JOIN fsj.usuario r ON r.id = m.registrado_por_id
      LEFT JOIN fsj.usuario a ON a.id = m.autorizado_por_id
      WHERE m.tenant_id = ${filter.tenantId}::uuid
        AND m.tipo = 'AJUSTE'
        AND (${search}::text IS NULL OR ${drogaCoincideSql("d", search)} OR p.lote ILIKE '%' || ${search}::text || '%')
        AND (${motivo}::text IS NULL OR m.motivo_ajuste::text = ${motivo}::text)
        AND (${desde}::date IS NULL OR fsj.jornada_de(m.registrado_en, tn.zona_horaria) >= ${desde}::date)
        AND (${hasta}::date IS NULL OR fsj.jornada_de(m.registrado_en, tn.zona_horaria) <= ${hasta}::date)
    )
    SELECT
      t.total,
      t.zona_horaria,
      f.id,
      f.registrado_en,
      f.partida_id,
      f.lote,
      f.droga_id,
      f.droga_nombre,
      f.unidad_id,
      f.unidad_simbolo,
      f.cantidad::text AS cantidad,
      f.motivo_ajuste::text AS motivo_ajuste,
      f.observacion,
      f.registrado_por_nombre,
      f.registrado_por_apellido,
      f.autorizado_por_nombre,
      f.autorizado_por_apellido
    FROM (
      SELECT
        (SELECT count(*)::int FROM filtrados) AS total,
        (SELECT zona_horaria FROM fsj.tenant WHERE id = ${filter.tenantId}::uuid) AS zona_horaria
    ) t
    LEFT JOIN LATERAL (
      SELECT *
      FROM filtrados
      ORDER BY registrado_en DESC, id DESC
      LIMIT ${filter.pageSize}::int OFFSET ${skip}::int
    ) f ON true
  `;
}

export async function listAjustes(tx: Prisma.TransactionClient, filter: ListAjustesFilter): Promise<ListAjustesResult> {
  const rows = await tx.$queryRaw<ListAjustesRow[]>(listAjustesSql(filter));
  if (!rows[0]) throw new Error(`listAjustes: no row for tenant ${filter.tenantId}`);

  return {
    items: rows
      .filter((row) => row.id !== null)
      .map((row) => ({
        id: row.id!,
        registradoEn: row.registrado_en!,
        partidaId: row.partida_id!,
        lote: row.lote!,
        drogaId: row.droga_id!,
        drogaNombre: row.droga_nombre!,
        unidadId: row.unidad_id!,
        unidadSimbolo: row.unidad_simbolo!,
        cantidad: row.cantidad!,
        motivoAjuste: row.motivo_ajuste!,
        observacion: row.observacion,
        registradoPorNombre: row.registrado_por_nombre!,
        registradoPorApellido: row.registrado_por_apellido!,
        autorizadoPorNombre: row.autorizado_por_nombre,
        autorizadoPorApellido: row.autorizado_por_apellido,
      })),
    total: rows[0].total,
    page: filter.page,
    pageSize: filter.pageSize,
    zonaHoraria: rows[0].zona_horaria,
  };
}

// ============================================================================
// 5.7: alertas (bajo stock_minimo, por vencer, vencidas con saldo). Read-only
// -- `stock.ver`. "Por vencer"/"vencidas" both key off `fsj.jornada_actual`,
// never `new Date()`/CURRENT_DATE.
// ============================================================================

export interface AlertaBajoMinimo {
  drogaId: string;
  drogaNombre: string;
  stockMinimo: string;
  stockDisponible: string;
}

export async function alertasBajoMinimo(tx: Prisma.TransactionClient, tenantId: string): Promise<AlertaBajoMinimo[]> {
  const rows = await tx.$queryRaw<{ droga_id: string; nombre: string; stock_minimo: string; stock_disponible: string }[]>`
    SELECT d.id AS droga_id, d.nombre, d.stock_minimo::text, coalesce(v.stock_disponible, 0)::text AS stock_disponible
    FROM fsj.droga d
    LEFT JOIN fsj.v_stock_droga v ON v.tenant_id = d.tenant_id AND v.droga_id = d.id
    WHERE d.tenant_id = ${tenantId}::uuid AND d.fecha_baja IS NULL
      AND coalesce(v.stock_disponible, 0) < d.stock_minimo
    ORDER BY d.nombre ASC
  `;
  return rows.map((row) => ({
    drogaId: row.droga_id,
    drogaNombre: row.nombre,
    stockMinimo: row.stock_minimo,
    stockDisponible: row.stock_disponible,
  }));
}

/** How many drogas `alertasBajoMinimo` above would list (keep them in sync): one aggregate for the app-wide banner. */
export async function contarDrogasBajoMinimo(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ cantidad: number }[]>`
    SELECT count(*)::int AS cantidad
    FROM fsj.droga d
    LEFT JOIN fsj.v_stock_droga v ON v.tenant_id = d.tenant_id AND v.droga_id = d.id
    WHERE d.tenant_id = ${tenantId}::uuid AND d.fecha_baja IS NULL
      AND coalesce(v.stock_disponible, 0) < d.stock_minimo
  `;
  return rows[0]?.cantidad ?? 0;
}

export interface AlertaPorVencer {
  partidaId: string;
  drogaId: string;
  drogaNombre: string;
  lote: string;
  proveedorRazonSocial: string;
  /** In the droga's unidad base (`unidadBaseId` / `unidadBaseSimbolo`). */
  cantidadDisponible: string;
  unidadBaseId: string;
  unidadBaseSimbolo: string;
  /** The vencimiento VIGENTE (migration 0074). */
  fechaVencimiento: Date;
  /** The ORIGINAL (printed) vencimiento; differs from `fechaVencimiento` only when `reanalizada`. */
  fechaVencimientoOriginal: Date;
  /** A DROGA partida (migration 0063): blocked when vencida until the DT acts; re-analysable (docs/specs/reanalisis-partida.md). */
  esDroga: boolean;
  /** The vigente date comes from a reanálisis (differs from the original one). */
  reanalizada: boolean;
}

/**
 * An expired partida that STILL has balance. `esDroga` = blocked until the DT acts (reanálisis or "marcar como
 * vencida", docs/specs/reanalisis-partida.md); an insumo's suggests a VENCIMIENTO ajuste (plan §9 M07 historia 6).
 */
export type AlertaVencidaConSaldo = AlertaPorVencer;

interface AlertaVencimientoRow {
  partida_id: string;
  droga_id: string;
  nombre: string;
  lote: string;
  proveedor_razon_social: string;
  cantidad_disponible: string;
  unidad_base_id: string;
  unidad_base_simbolo: string;
  fecha_vencimiento_vigente: Date;
  fecha_vencimiento: Date;
  es_droga: boolean;
  reanalizada: boolean;
}

function alertaDesdeRow(row: AlertaVencimientoRow): AlertaPorVencer {
  return {
    partidaId: row.partida_id,
    drogaId: row.droga_id,
    drogaNombre: row.nombre,
    lote: row.lote,
    proveedorRazonSocial: row.proveedor_razon_social,
    cantidadDisponible: row.cantidad_disponible,
    unidadBaseId: row.unidad_base_id,
    unidadBaseSimbolo: row.unidad_base_simbolo,
    fechaVencimiento: row.fecha_vencimiento_vigente,
    fechaVencimientoOriginal: row.fecha_vencimiento,
    esDroga: row.es_droga,
    reanalizada: row.reanalizada,
  };
}

/** Partidas with balance whose vencimiento VIGENTE falls within `[jornadaActual, jornadaActual + diasAlerta]` -- excludes already-expired ones (those are `alertasVencidasConSaldo`'s job). */
export async function alertasPorVencer(tx: Prisma.TransactionClient, tenantId: string, diasAlerta: number): Promise<AlertaPorVencer[]> {
  const rows = await tx.$queryRaw<AlertaVencimientoRow[]>`
    SELECT p.id AS partida_id, d.id AS droga_id, d.nombre, p.lote, coalesce(pv.razon_social, ${ETIQUETA_SIN_PROVEEDOR}) AS proveedor_razon_social,
      p.cantidad_disponible::text, u.id AS unidad_base_id, u.simbolo AS unidad_base_simbolo,
      p.fecha_vencimiento_vigente, p.fecha_vencimiento,
      d.clase = 'DROGA' AS es_droga, p.fecha_vencimiento_vigente IS DISTINCT FROM p.fecha_vencimiento AS reanalizada
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    LEFT JOIN fsj.proveedor pv ON pv.tenant_id = p.tenant_id AND pv.id = p.proveedor_id
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.cantidad_disponible > 0
      AND p.fecha_vencimiento_vigente >= fsj.jornada_actual(${tenantId}::uuid)
      AND p.fecha_vencimiento_vigente <= (fsj.jornada_actual(${tenantId}::uuid) + (${diasAlerta}::int || ' days')::interval)
    ORDER BY p.fecha_vencimiento_vigente ASC
  `;
  return rows.map(alertaDesdeRow);
}

/** Expired partidas (vencimiento VIGENTE < jornada) that STILL have balance. */
export async function alertasVencidasConSaldo(tx: Prisma.TransactionClient, tenantId: string): Promise<AlertaVencidaConSaldo[]> {
  const rows = await tx.$queryRaw<AlertaVencimientoRow[]>`
    SELECT p.id AS partida_id, d.id AS droga_id, d.nombre, p.lote, coalesce(pv.razon_social, ${ETIQUETA_SIN_PROVEEDOR}) AS proveedor_razon_social,
      p.cantidad_disponible::text, u.id AS unidad_base_id, u.simbolo AS unidad_base_simbolo,
      p.fecha_vencimiento_vigente, p.fecha_vencimiento,
      d.clase = 'DROGA' AS es_droga, p.fecha_vencimiento_vigente IS DISTINCT FROM p.fecha_vencimiento AS reanalizada
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    LEFT JOIN fsj.proveedor pv ON pv.tenant_id = p.tenant_id AND pv.id = p.proveedor_id
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.cantidad_disponible > 0
      AND p.fecha_vencimiento_vigente < fsj.jornada_actual(${tenantId}::uuid)
    ORDER BY p.fecha_vencimiento_vigente ASC
  `;
  return rows.map(alertaDesdeRow);
}

export interface ResumenVencimientosDrogas {
  /** Distinct DROGA drogas (insumos excluded) with a vencida partida that still has balance. */
  drogasVencidas: number;
  /** Distinct DROGA drogas with a partida por vencer (balance, vigente date within the alert window). */
  drogasPorVencer: number;
}

/**
 * One aggregate row for the app-wide banner: the same predicates as `alertasVencidasConSaldo` /
 * `alertasPorVencer` above (keep them in sync), restricted to DROGA partidas -- the ones that wait on the DT
 * (docs/specs/reanalisis-partida.md) -- and counted per droga instead of listed.
 */
export async function resumenVencimientosDrogas(tx: Prisma.TransactionClient, tenantId: string, diasAlerta: number): Promise<ResumenVencimientosDrogas> {
  const rows = await tx.$queryRaw<{ drogas_vencidas: number; drogas_por_vencer: number }[]>`
    WITH j AS (SELECT fsj.jornada_actual(${tenantId}::uuid) AS jornada)
    SELECT
      (count(DISTINCT p.droga_id) FILTER (WHERE p.fecha_vencimiento_vigente < j.jornada))::int AS drogas_vencidas,
      (count(DISTINCT p.droga_id) FILTER (
        WHERE p.fecha_vencimiento_vigente >= j.jornada
          AND p.fecha_vencimiento_vigente <= (j.jornada + (${diasAlerta}::int || ' days')::interval)
      ))::int AS drogas_por_vencer
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    CROSS JOIN j
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.cantidad_disponible > 0
      AND d.clase = 'DROGA'
  `;
  return { drogasVencidas: rows[0]?.drogas_vencidas ?? 0, drogasPorVencer: rows[0]?.drogas_por_vencer ?? 0 };
}

// ============================================================================
// Reanálisis de partida (migration 0074, docs/specs/reanalisis-partida.md):
// append-only rows; the DB trigger moves partida.fecha_vencimiento_vigente
// and re-checks INV-S22 (droga, saldo, date, DT vigente).
// ============================================================================

export interface NuevoReanalisisInput {
  tenantId: string;
  partidaId: string;
  /** YYYY-MM-DD. */
  fechaReanalisis: string;
  motivo: string | null;
  respaldo: string | null;
  /** The DT vigente registering it -- the session's own usuario, verified by its password in the same request. */
  registradoPorId: string;
}

export async function insertReanalisis(tx: Prisma.TransactionClient, input: NuevoReanalisisInput): Promise<{ id: string; fechaVencimientoAnterior: string }> {
  // fecha_vencimiento_anterior is NOT NULL but set by the BEFORE INSERT trigger from the partida: this placeholder is
  // always overwritten, and the returned row carries the trigger's value.
  const row = await tx.reanalisisPartida.create({
    data: {
      tenantId: input.tenantId,
      partidaId: input.partidaId,
      fechaReanalisis: new Date(`${input.fechaReanalisis}T00:00:00Z`),
      fechaVencimientoAnterior: new Date(`${input.fechaReanalisis}T00:00:00Z`),
      motivo: input.motivo,
      respaldo: input.respaldo,
      registradoPorId: input.registradoPorId,
    },
    select: { id: true, fechaVencimientoAnterior: true },
  });
  return { id: row.id, fechaVencimientoAnterior: row.fechaVencimientoAnterior.toISOString().slice(0, 10) };
}

export interface ReanalisisItem {
  id: string;
  fechaReanalisis: Date;
  fechaVencimientoAnterior: Date;
  motivo: string | null;
  respaldo: string | null;
  registradoPorNombre: string;
  registradoPorApellido: string;
  registradoEn: Date;
}

/** Every reanálisis of `partidaId`, newest first (a partida has a handful at most: no pagination). */
export async function listReanalisisDePartida(tx: Prisma.TransactionClient, tenantId: string, partidaId: string): Promise<ReanalisisItem[]> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      fecha_reanalisis: Date;
      fecha_vencimiento_anterior: Date;
      motivo: string | null;
      respaldo: string | null;
      nombre: string;
      apellido: string;
      registrado_en: Date;
    }[]
  >`
    SELECT r.id, r.fecha_reanalisis, r.fecha_vencimiento_anterior, r.motivo, r.respaldo, u.nombre, u.apellido, r.registrado_en
    FROM fsj.reanalisis_partida r
    JOIN fsj.usuario u ON u.tenant_id = r.tenant_id AND u.id = r.registrado_por_id
    WHERE r.tenant_id = ${tenantId}::uuid AND r.partida_id = ${partidaId}::uuid
    ORDER BY r.registrado_en DESC, r.id DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    fechaReanalisis: r.fecha_reanalisis,
    fechaVencimientoAnterior: r.fecha_vencimiento_anterior,
    motivo: r.motivo,
    respaldo: r.respaldo,
    registradoPorNombre: r.nombre,
    registradoPorApellido: r.apellido,
    registradoEn: r.registrado_en,
  }));
}

/**
 * `dias_alerta_vencimiento_partida` `parametro` row (DP-14), with a
 * defensive fallback to `DIAS_ALERTA_VENCIMIENTO_PARTIDA_DEFAULT` when the
 * tenant has no row yet -- same "defensive fallback" discipline as
 * `modules/parametros/application/list-parametros.ts`. Reads `fsj.parametro`
 * directly (not through `modules/parametros/infrastructure`) because
 * modules cannot reach into another module's infrastructure layer -- see
 * modules/usuarios/infrastructure/admin-guard.ts's header comment.
 */
export async function getDiasAlertaVencimiento(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const row = await tx.parametro.findUnique({
    where: { tenantId_clave: { tenantId, clave: "dias_alerta_vencimiento_partida" } },
    select: { valor: true },
  });
  const raw = row?.valor ?? DIAS_ALERTA_VENCIMIENTO_PARTIDA_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}
