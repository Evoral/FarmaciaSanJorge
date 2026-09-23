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
import type { Prisma } from "@/generated/prisma/client";
import type { TipoMovimiento, MotivoAjuste as PrismaMotivoAjuste } from "@/generated/prisma/enums";
import { DIAS_ALERTA_VENCIMIENTO_PARTIDA_DEFAULT } from "../domain/partida";

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
  unidadSimbolo: string;
  stockMinimo: string;
  stockDisponible: string;
  esControlada: boolean;
}

export interface ListStockDrogasFilter {
  tenantId: string;
  search?: string;
  soloBajoMinimo?: boolean;
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
 * does the SUM, this only joins/filters/paginates. `soloBajoMinimo` cannot
 * be expressed as a plain WHERE (the comparison is between two columns from
 * different relations after aggregation), so it's a HAVING-shaped raw query.
 */
export async function listStockDrogas(tx: Prisma.TransactionClient, filter: ListStockDrogasFilter): Promise<ListStockDrogasResult> {
  const search = filter.search?.trim();
  const skip = (filter.page - 1) * filter.pageSize;

  const rows = await tx.$queryRaw<
    { droga_id: string; nombre: string; simbolo: string; stock_minimo: string; stock_disponible: string; es_controlada: boolean }[]
  >`
    SELECT d.id AS droga_id, d.nombre, u.simbolo, d.stock_minimo::text, coalesce(v.stock_disponible, 0)::text AS stock_disponible, d.es_controlada
    FROM fsj.droga d
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    LEFT JOIN fsj.v_stock_droga v ON v.tenant_id = d.tenant_id AND v.droga_id = d.id
    WHERE d.tenant_id = ${filter.tenantId}::uuid
      AND d.fecha_baja IS NULL
      AND (${search ?? null}::text IS NULL OR d.nombre ILIKE '%' || ${search ?? null}::text || '%')
    ORDER BY d.nombre ASC
  `;

  const filtered = filter.soloBajoMinimo
    ? rows.filter((row) => Number(row.stock_disponible) < Number(row.stock_minimo))
    : rows;

  const page = filtered.slice(skip, skip + filter.pageSize);

  return {
    items: page.map((row) => ({
      drogaId: row.droga_id,
      drogaNombre: row.nombre,
      unidadSimbolo: row.simbolo,
      stockMinimo: row.stock_minimo,
      stockDisponible: row.stock_disponible,
      esControlada: row.es_controlada,
    })),
    total: filtered.length,
    page: filter.page,
    pageSize: filter.pageSize,
  };
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
  const [total, rows] = await Promise.all([
    tx.partida.count({ where }),
    tx.partida.findMany({
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
    }),
  ]);

  return {
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
      droga: { select: { nombre: true } },
      proveedor: { select: { razonSocial: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    drogaId: row.drogaId,
    drogaNombre: row.droga.nombre,
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
  unidadBaseId: string;
  tipoControl: string;
  fechaBaja: Date | null;
}

export async function getDrogaParaIngreso(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<DrogaParaIngreso | null> {
  const row = await tx.droga.findUnique({
    where: { id: drogaId, tenantId },
    select: { id: true, unidadBaseId: true, tipoControl: true, fechaBaja: true },
  });
  return row;
}

export interface ProveedorParaIngreso {
  id: string;
  fechaBaja: Date | null;
}

export async function getProveedorParaIngreso(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string): Promise<ProveedorParaIngreso | null> {
  return tx.proveedor.findUnique({ where: { id: proveedorId, tenantId }, select: { id: true, fechaBaja: true } });
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
  desde?: string; // YYYY-MM-DD
  hasta?: string; // YYYY-MM-DD
  page: number;
  pageSize: number;
}

export interface KardexResult {
  items: KardexItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function kardexMovimientos(tx: Prisma.TransactionClient, filter: KardexFilter): Promise<KardexResult> {
  const where: Prisma.MovimientoStockWhereInput = { tenantId: filter.tenantId };
  if (filter.partidaId) where.partidaId = filter.partidaId;
  if (filter.drogaId) where.partida = { drogaId: filter.drogaId };
  if (filter.tipo) where.tipo = filter.tipo;
  if (filter.desde || filter.hasta) {
    where.registradoEn = {
      ...(filter.desde ? { gte: new Date(`${filter.desde}T00:00:00Z`) } : {}),
      ...(filter.hasta ? { lte: new Date(`${filter.hasta}T23:59:59.999Z`) } : {}),
    };
  }

  const skip = (filter.page - 1) * filter.pageSize;
  const [total, rows] = await Promise.all([
    tx.movimientoStock.count({ where }),
    tx.movimientoStock.findMany({
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
        partida: { select: { lote: true, droga: { select: { nombre: true } } } },
        registradoPor: { select: { nombre: true, apellido: true } },
        autorizadoPor: { select: { nombre: true, apellido: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      partidaId: row.partidaId,
      drogaNombre: row.partida.droga.nombre,
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
