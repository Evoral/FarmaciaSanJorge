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
  /** Earliest `fecha_vencimiento` among partidas with balance (YYYY-MM-DD), `null` when none has balance. */
  proximoVencimiento: string | null;
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
        coalesce(v.stock_disponible, 0) AS stock_disponible,
        coalesce(v.stock_disponible, 0) * u.factor_a_base AS stock_en_base,
        (
          SELECT min(p.fecha_vencimiento)
          FROM fsj.partida p
          WHERE p.tenant_id = d.tenant_id AND p.droga_id = d.id AND p.cantidad_disponible > 0
        ) AS proximo_vencimiento
      FROM fsj.droga d
      JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
      LEFT JOIN fsj.v_stock_droga v ON v.tenant_id = d.tenant_id AND v.droga_id = d.id
      WHERE d.tenant_id = ${filter.tenantId}::uuid
        AND d.fecha_baja IS NULL
        AND (${search}::text IS NULL OR d.nombre ILIKE '%' || ${search}::text || '%')
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
              AND p.fecha_vencimiento >= fsj.jornada_actual(${filter.tenantId}::uuid)
              AND p.fecha_vencimiento <= (fsj.jornada_actual(${filter.tenantId}::uuid) + (${filter.diasAlertaVencimiento}::int || ' days')::interval)
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
              AND p.fecha_vencimiento < fsj.jornada_actual(${filter.tenantId}::uuid)
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
      f.proximo_vencimiento::text AS proximo_vencimiento
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
  proveedorId: string;
  proveedorRazonSocial: string;
  costoUnitario: string;
  cantidadInicial: string;
  cantidadDisponible: string;
  fechaIngreso: Date;
  fechaVencimiento: Date;
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
  droga: { nombre: string; unidadBaseId: string; unidadBaseSimbolo: string } | null;
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
    where.fechaVencimiento = { lt: new Date(`${jornada}T00:00:00Z`) };
  }

  const skip = (filter.page - 1) * filter.pageSize;
  const droga = await tx.droga.findUnique({
    where: { id: filter.drogaId, tenantId: filter.tenantId },
    select: { nombre: true, unidadBaseId: true, unidadBase: { select: { simbolo: true } } },
  });
  const total = await tx.partida.count({ where });
  const rows = await tx.partida.findMany({
    where,
    orderBy: [{ fechaVencimiento: "asc" }],
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
      fechaApertura: true,
      proveedor: { select: { razonSocial: true } },
    },
  });

  return {
    droga: droga ? { nombre: droga.nombre, unidadBaseId: droga.unidadBaseId, unidadBaseSimbolo: droga.unidadBase.simbolo } : null,
    items: rows.map((row) => ({
      id: row.id,
      lote: row.lote,
      proveedorId: row.proveedorId,
      proveedorRazonSocial: row.proveedor.razonSocial,
      costoUnitario: row.costoUnitario.toString(),
      cantidadInicial: row.cantidadInicial.toString(),
      cantidadDisponible: row.cantidadDisponible.toString(),
      fechaIngreso: row.fechaIngreso,
      fechaVencimiento: row.fechaVencimiento,
      fechaApertura: row.fechaApertura,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
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
  /** The droga unidad base -- every quantity of the partida is recorded in it. */
  unidadBaseId: string;
  unidadBaseSimbolo: string;
  proveedorId: string;
  proveedorRazonSocial: string;
  lote: string;
  costoUnitario: string;
  cantidadInicial: string;
  cantidadDisponible: string;
  fechaIngreso: Date;
  fechaVencimiento: Date;
  fechaApertura: Date | null;
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
      fechaApertura: true,
      droga: { select: { nombre: true, unidadBaseId: true, unidadBase: { select: { simbolo: true } } } },
      proveedor: { select: { razonSocial: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    drogaId: row.drogaId,
    drogaNombre: row.droga.nombre,
    unidadBaseId: row.droga.unidadBaseId,
    unidadBaseSimbolo: row.droga.unidadBase.simbolo,
    proveedorId: row.proveedorId,
    proveedorRazonSocial: row.proveedor.razonSocial,
    lote: row.lote,
    costoUnitario: row.costoUnitario.toString(),
    cantidadInicial: row.cantidadInicial.toString(),
    cantidadDisponible: row.cantidadDisponible.toString(),
    fechaIngreso: row.fechaIngreso,
    fechaVencimiento: row.fechaVencimiento,
    fechaApertura: row.fechaApertura,
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
  tenantId: string;
  drogaId: string;
  proveedorId: string;
  lote: string;
  costoUnitario: string;
  /** Already converted to the droga's unidad base -- see ingresar-partida.ts. */
  cantidadInicialBase: string;
  fechaVencimiento: string; // YYYY-MM-DD
  registradoPorId: string;
  numeroValeAdquisicion: string | null;
}

/** Reads what `ingresar-partida.ts` needs to decide unit conversion + INV-L16 (numero_vale_adquisicion), in one round trip. */
export interface DrogaParaIngreso {
  id: string;
  nombre: string;
  unidadBaseId: string;
  tipoControl: string;
  fechaBaja: Date | null;
}

export async function getDrogaParaIngreso(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<DrogaParaIngreso | null> {
  const row = await tx.droga.findUnique({
    where: { id: drogaId, tenantId },
    select: { id: true, nombre: true, unidadBaseId: true, tipoControl: true, fechaBaja: true },
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
      fechaVencimiento: new Date(`${input.fechaVencimiento}T00:00:00Z`),
    },
    select: { id: true },
  });

  await tx.movimientoStock.create({
    data: {
      tenantId: input.tenantId,
      partidaId: partida.id,
      tipo: "INGRESO_COMPRA" as TipoMovimiento,
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
    },
    select: { id: true },
  });
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
  /** Case-insensitive substring of the droga name or the lote. */
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
        AND (${search}::text IS NULL OR d.nombre ILIKE '%' || ${search}::text || '%' OR p.lote ILIKE '%' || ${search}::text || '%')
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

export interface AlertaPorVencer {
  partidaId: string;
  drogaNombre: string;
  lote: string;
  cantidadDisponible: string;
  fechaVencimiento: Date;
}

/** Partidas with balance whose `fecha_vencimiento` falls within `[jornadaActual, jornadaActual + diasAlerta]` -- excludes already-expired ones (those are `alertasVencidasConSaldo`'s job). */
export async function alertasPorVencer(tx: Prisma.TransactionClient, tenantId: string, diasAlerta: number): Promise<AlertaPorVencer[]> {
  const rows = await tx.$queryRaw<{ partida_id: string; nombre: string; lote: string; cantidad_disponible: string; fecha_vencimiento: Date }[]>`
    SELECT p.id AS partida_id, d.nombre, p.lote, p.cantidad_disponible::text, p.fecha_vencimiento
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.cantidad_disponible > 0
      AND p.fecha_vencimiento >= fsj.jornada_actual(${tenantId}::uuid)
      AND p.fecha_vencimiento <= (fsj.jornada_actual(${tenantId}::uuid) + (${diasAlerta}::int || ' days')::interval)
    ORDER BY p.fecha_vencimiento ASC
  `;
  return rows.map((row) => ({
    partidaId: row.partida_id,
    drogaNombre: row.nombre,
    lote: row.lote,
    cantidadDisponible: row.cantidad_disponible,
    fechaVencimiento: row.fecha_vencimiento,
  }));
}

export interface AlertaVencidaConSaldo {
  partidaId: string;
  drogaNombre: string;
  lote: string;
  cantidadDisponible: string;
  fechaVencimiento: Date;
}

/** Expired partidas that STILL have balance -- suggests a VENCIMIENTO ajuste (plan §9 M07 historia 6). */
export async function alertasVencidasConSaldo(tx: Prisma.TransactionClient, tenantId: string): Promise<AlertaVencidaConSaldo[]> {
  const rows = await tx.$queryRaw<{ partida_id: string; nombre: string; lote: string; cantidad_disponible: string; fecha_vencimiento: Date }[]>`
    SELECT p.id AS partida_id, d.nombre, p.lote, p.cantidad_disponible::text, p.fecha_vencimiento
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.cantidad_disponible > 0
      AND p.fecha_vencimiento < fsj.jornada_actual(${tenantId}::uuid)
    ORDER BY p.fecha_vencimiento ASC
  `;
  return rows.map((row) => ({
    partidaId: row.partida_id,
    drogaNombre: row.nombre,
    lote: row.lote,
    cantidadDisponible: row.cantidad_disponible,
    fechaVencimiento: row.fecha_vencimiento,
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
