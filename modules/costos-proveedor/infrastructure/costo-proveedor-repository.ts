/**
 * Prisma-backed access to `fsj.costo_proveedor` and `fsj.lista_precio_proveedor`
 * (migration 0079, openspec/specs/costos-proveedor/spec.md). Every function runs inside
 * an ALREADY OPEN tenant transaction (`tx`), same convention as
 * modules/precios/infrastructure/regla-precio-repository.ts.
 *
 * VERSIONING (R2, R23): a change never updates a costo. The command calls
 * `lockVigentes` FIRST for every (droga, proveedor) pair it will touch, decides
 * from those fresh rows (`planVersionar`), then `cerrarVigente` + `insertCostoProveedor`
 * with the SAME instant (`ahoraServidor`) as `vigente_hasta` and `vigente_desde`.
 * Two concurrent commands on a pair serialize on the row lock; when a pair has
 * no vigente yet there is nothing to lock and the partial unique index
 * (`costo_proveedor_una_vigente_por_par`) is the last guard.
 *
 * Dates (`fecha_precio`, `fecha_lista`) cross this boundary as `YYYY-MM-DD`
 * strings; money/quantities as decimal strings (never `number`).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AliasDroga } from "@/modules/recetas/domain/importacion-receta";
import { ALICUOTA_IVA_POR_DEFECTO, parsearAlicuotaIva } from "../domain/costo-proveedor";
import type { DrogaParaLista, UnidadParaLista, VigenteParaLista } from "../domain/importacion-lista";

export { ahoraServidor } from "@/shared/db/ahora-servidor";

/** `YYYY-MM-DD` of a `date` column read through Prisma (UTC midnight). */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` -> the `Date` Prisma expects for a `date` column (UTC midnight, same as comprobante_compra). */
function fechaADate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

// ============================================================================
// Reads the commands and the consultation queries need (E3)
// ============================================================================

/** `fsj.jornada_actual(tenant)` as `YYYY-MM-DD`: the pharmacy's business day, never the client's clock (R8). Same helper each module keeps (modules/stock, cierres, archivo). */
export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

export interface ContextoTemporal {
  /** `YYYY-MM-DD`. */
  jornadaActual: string;
  /** IANA zone of the pharmacy: `timestamptz` values are shown as its calendar day. */
  zonaHoraria: string;
}

/** What a screen needs to show dates and ages: the jornada actual and the pharmacy's time zone. */
export async function getContextoTemporal(tx: Prisma.TransactionClient, tenantId: string): Promise<ContextoTemporal> {
  const jornadaActual = await jornadaActualTenant(tx, tenantId);
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  return { jornadaActual, zonaHoraria: tenant.zonaHoraria };
}

/** A unidad de medida as a costo row needs it (global catalog, DP-39: no tenant filter; bajas included so the caller can tell "does not exist" from "dada de baja"). */
export interface UnidadCosto {
  id: string;
  codigo: string;
  simbolo: string;
  tipoMagnitud: string;
  /** `factor_a_base` as a plain decimal string. */
  factorABase: string;
  fechaBaja: Date | null;
}

/** unidad id -> its row for the given ids; missing ids are absent from the map. */
export async function getUnidadesParaCosto(tx: Prisma.TransactionClient, unidadIds: readonly string[]): Promise<Map<string, UnidadCosto>> {
  if (unidadIds.length === 0) return new Map();
  const rows = await tx.unidadMedida.findMany({
    where: { id: { in: [...new Set(unidadIds)] } },
    select: { id: true, codigo: true, simbolo: true, tipoMagnitud: true, factorABase: true, fechaBaja: true },
  });
  return new Map(rows.map((row) => [row.id, { ...row, factorABase: row.factorABase.toFixed() }]));
}

export interface DrogaParaCosto {
  id: string;
  nombre: string;
  /** The droga was given de baja: no new costo for it (R12). */
  fechaBaja: Date | null;
  unidadBaseId: string;
}

/** droga id -> its row for the given ids of the tenant; missing ids are absent from the map. */
export async function getDrogasParaCosto(tx: Prisma.TransactionClient, tenantId: string, drogaIds: readonly string[]): Promise<Map<string, DrogaParaCosto>> {
  if (drogaIds.length === 0) return new Map();
  const rows = await tx.droga.findMany({
    where: { tenantId, id: { in: [...new Set(drogaIds)] } },
    select: { id: true, nombre: true, fechaBaja: true, unidadBaseId: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

export interface ProveedorParaCosto {
  id: string;
  razonSocial: string;
  /** The proveedor was given de baja: no new costo for it (R12). */
  fechaBaja: Date | null;
}

export async function getProveedorParaCosto(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string): Promise<ProveedorParaCosto | null> {
  return tx.proveedor.findUnique({ where: { id: proveedorId, tenantId }, select: { id: true, razonSocial: true, fechaBaja: true } });
}

// ============================================================================
// Locking + writes
// ============================================================================

export interface ParDrogaProveedor {
  drogaId: string;
  proveedorId: string;
}

/** A vigente costo as the command needs it to version a pair (`planVersionar`). */
export interface CostoProveedorVigenteBloqueado {
  id: string;
  drogaId: string;
  proveedorId: string;
  precioInformado: string;
  unidadPrecioId: string;
  costoUnitario: string;
  /** R7a: percent. */
  alicuotaIva: string;
  precioInformadoConIva: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
  vigenteDesde: Date;
}

/**
 * Locks (`SELECT ... FOR UPDATE`) the vigente costo of every given pair that
 * has one, in ONE statement ordered by (droga_id, proveedor_id): two commands
 * touching overlapping sets always lock in the same order, so they can not
 * deadlock (same reason as tests/unit/stock-m3-lock-order.test.ts: a lock order
 * that depends on the input order deadlocks two imports of the same drogas in
 * different row order). Pairs without a vigente are simply absent; duplicated
 * pairs are harmless. Returned in lock order.
 */
export async function lockVigentes(tx: Prisma.TransactionClient, tenantId: string, pares: readonly ParDrogaProveedor[]): Promise<CostoProveedorVigenteBloqueado[]> {
  if (pares.length === 0) return [];
  const unicos = [...new Map(pares.map((par) => [`${par.drogaId}|${par.proveedorId}`, par])).values()].sort(
    (a, b) => (a.drogaId < b.drogaId ? -1 : a.drogaId > b.drogaId ? 1 : a.proveedorId < b.proveedorId ? -1 : a.proveedorId > b.proveedorId ? 1 : 0),
  );
  const drogaIds = unicos.map((par) => par.drogaId);
  const proveedorIds = unicos.map((par) => par.proveedorId);
  const rows = await tx.$queryRaw<
    {
      id: string;
      droga_id: string;
      proveedor_id: string;
      precio_informado: string;
      unidad_precio_id: string;
      costo_unitario: string;
      alicuota_iva: string;
      precio_informado_con_iva: string;
      fecha_precio: string;
      vigente_desde: Date;
    }[]
  >`
    SELECT c.id, c.droga_id, c.proveedor_id, c.precio_informado::text AS precio_informado, c.unidad_precio_id,
           c.costo_unitario::text AS costo_unitario, c.alicuota_iva::text AS alicuota_iva,
           c.precio_informado_con_iva::text AS precio_informado_con_iva,
           to_char(c.fecha_precio, 'YYYY-MM-DD') AS fecha_precio, c.vigente_desde
    FROM fsj.costo_proveedor c
    JOIN unnest(${drogaIds}::uuid[], ${proveedorIds}::uuid[]) AS p(droga_id, proveedor_id)
      ON c.droga_id = p.droga_id AND c.proveedor_id = p.proveedor_id
    WHERE c.tenant_id = ${tenantId}::uuid AND c.vigente_hasta IS NULL
    ORDER BY c.droga_id, c.proveedor_id
    FOR UPDATE OF c
  `;
  return rows.map((row) => ({
    id: row.id,
    drogaId: row.droga_id,
    proveedorId: row.proveedor_id,
    precioInformado: row.precio_informado,
    unidadPrecioId: row.unidad_precio_id,
    costoUnitario: row.costo_unitario,
    alicuotaIva: row.alicuota_iva,
    precioInformadoConIva: row.precio_informado_con_iva,
    fechaPrecio: row.fecha_precio,
    vigenteDesde: row.vigente_desde,
  }));
}

/** A costo (vigente or already closed) locked by id, for a baja. */
export interface CostoProveedorBloqueado extends CostoProveedorVigenteBloqueado {
  /** `null` = still vigente. */
  vigenteHasta: Date | null;
}

/**
 * Locks (`SELECT ... FOR UPDATE`) ONE costo by id, vigente or not, so the baja
 * can tell "does not exist" (`null`) from "no longer vigente" (`vigenteHasta`
 * set: replaced or already given de baja) from a fresh read taken under the lock.
 */
export async function lockCostoPorId(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<CostoProveedorBloqueado | null> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      droga_id: string;
      proveedor_id: string;
      precio_informado: string;
      unidad_precio_id: string;
      costo_unitario: string;
      alicuota_iva: string;
      precio_informado_con_iva: string;
      fecha_precio: string;
      vigente_desde: Date;
      vigente_hasta: Date | null;
    }[]
  >`
    SELECT c.id, c.droga_id, c.proveedor_id, c.precio_informado::text AS precio_informado, c.unidad_precio_id,
           c.costo_unitario::text AS costo_unitario, c.alicuota_iva::text AS alicuota_iva,
           c.precio_informado_con_iva::text AS precio_informado_con_iva, to_char(c.fecha_precio, 'YYYY-MM-DD') AS fecha_precio, c.vigente_desde, c.vigente_hasta
    FROM fsj.costo_proveedor c
    WHERE c.tenant_id = ${tenantId}::uuid AND c.id = ${id}::uuid
    FOR UPDATE OF c
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    drogaId: row.droga_id,
    proveedorId: row.proveedor_id,
    precioInformado: row.precio_informado,
    unidadPrecioId: row.unidad_precio_id,
    costoUnitario: row.costo_unitario,
    alicuotaIva: row.alicuota_iva,
    precioInformadoConIva: row.precio_informado_con_iva,
    fechaPrecio: row.fecha_precio,
    vigenteDesde: row.vigente_desde,
    vigenteHasta: row.vigente_hasta,
  };
}

/** Closes a vigente costo (the ONLY write the DB allows after insert, INV-CP-001/002). MUST be called with an `id` `lockVigentes` just returned, in the SAME transaction, with the instant the replacing version starts at. */
export async function cerrarVigente(tx: Prisma.TransactionClient, tenantId: string, id: string, instante: Date): Promise<void> {
  await tx.costoProveedor.update({ where: { id, tenantId }, data: { vigenteHasta: instante } });
}

export interface NuevoCostoProveedorInput {
  tenantId: string;
  drogaId: string;
  proveedorId: string;
  /** Decimal string, exactly as typed (> 0). */
  precioInformado: string;
  unidadPrecioId: string;
  /** Decimal string, per the droga's unidad base (> 0); computed by the domain (`calcularCostoUnidadBase`). */
  costoUnitario: string;
  /** R7a: percent, and both prices with it, computed by the domain (`calcularConIva`; DB CHECKs, migration 0107). */
  alicuotaIva: string;
  precioInformadoConIva: string;
  costoUnitarioConIva: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
  descripcionProveedor: string | null;
  /** `null` = manual entry (R24). */
  listaPrecioId: string | null;
  motivo: string | null;
  /** The server instant (`ahoraServidor`), the same one the closed version's `vigente_hasta` got. */
  vigenteDesde: Date;
  creadoPorId: string;
}

export async function insertCostoProveedor(tx: Prisma.TransactionClient, input: NuevoCostoProveedorInput): Promise<{ id: string }> {
  return tx.costoProveedor.create({
    data: { ...input, fechaPrecio: fechaADate(input.fechaPrecio) },
    select: { id: true },
  });
}

export interface NuevaListaPrecioProveedorInput {
  tenantId: string;
  proveedorId: string;
  formato: "XLS" | "XLSX" | "PDF";
  nombreArchivo: string;
  /** SHA-256 of the file's bytes, lowercase hex (DB CHECK: 64 hex chars). */
  hashSha256: string;
  /** `YYYY-MM-DD`: the date the list's prices correspond to. */
  fechaLista: string;
  filasLeidas: number;
  filasAplicadas: number;
  registradoPorId: string;
}

export async function insertListaPrecioProveedor(tx: Prisma.TransactionClient, input: NuevaListaPrecioProveedorInput): Promise<{ id: string }> {
  return tx.listaPrecioProveedor.create({
    data: { ...input, fechaLista: fechaADate(input.fechaLista) },
    select: { id: true },
  });
}

/** R21: has this exact file (by SHA-256) already been imported for this proveedor? Read time warning; the DB unique `(tenant, proveedor, hash)` is the real guard. */
export async function existeListaConHash(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string, hashSha256: string): Promise<boolean> {
  const row = await tx.listaPrecioProveedor.findFirst({ where: { tenantId, proveedorId, hashSha256 }, select: { id: true } });
  return row !== null;
}

/** R21, with the date for the message ("Esta lista ya fue importada ... el <fecha>"): the list already imported with this hash for this proveedor, or `null`. */
export async function buscarListaPorHash(
  tx: Prisma.TransactionClient,
  tenantId: string,
  proveedorId: string,
  hashSha256: string,
): Promise<{ id: string; registradoEn: Date } | null> {
  return tx.listaPrecioProveedor.findFirst({ where: { tenantId, proveedorId, hashSha256 }, select: { id: true, registradoEn: true } });
}

// ============================================================================
// Reads of the list import (E4): matching drogas, synonyms, units, vigentes
// ============================================================================

/**
 * Every vigente droga with the magnitud of its unidad base, for matching list rows (R17) and
 * offering the right units (R5, R6). Bajas are left out (R12). The same "vigentes only" rule as
 * modules/stock/infrastructure/factura-compra-repository.ts (modules never share infrastructure).
 */
export async function listDrogasVigentesParaLista(tx: Prisma.TransactionClient, tenantId: string): Promise<DrogaParaLista[]> {
  const rows = await tx.droga.findMany({
    where: { tenantId, fechaBaja: null },
    orderBy: [{ nombre: "asc" }],
    select: { id: true, nombre: true, unidadBaseId: true, unidadBase: { select: { tipoMagnitud: true } } },
  });
  return rows.map((row) => ({ id: row.id, nombre: row.nombre, unidadBaseId: row.unidadBaseId, tipoMagnitud: row.unidadBase.tipoMagnitud }));
}

/** Vigente synonyms (of vigente drogas) among the given normalized texts (R17: a remembered synonym wins over the name). */
export async function listAliasesVigentesParaLista(tx: Prisma.TransactionClient, tenantId: string, aliasesNormalizados: readonly string[]): Promise<AliasDroga[]> {
  if (aliasesNormalizados.length === 0) return [];
  return tx.drogaAlias.findMany({
    where: { tenantId, aliasNormalizado: { in: [...new Set(aliasesNormalizados)] }, fechaBaja: null, droga: { fechaBaja: null } },
    select: { aliasNormalizado: true, drogaId: true },
  });
}

/**
 * What `aliasNormalizado` already resolves to, for "recordar equivalencia" (openspec/specs/sinonimos-droga/spec.md):
 * a VIGENTE synonym of a VIGENTE droga (`id` = the synonym's), or else -- `esNombre: true`, `id` = the droga's --
 * the normalized name of a vigente droga (a synonym can never repeat a droga's name, INV-DRG-002). `null` = free.
 * Same query as the invoice import's (modules/stock/infrastructure/factura-compra-repository.ts).
 */
export async function getDrogaAlias(
  tx: Prisma.TransactionClient,
  tenantId: string,
  aliasNormalizado: string,
): Promise<{ id: string; drogaId: string; esNombre?: boolean } | null> {
  const rows = await tx.$queryRaw<{ id: string; droga_id: string; es_nombre: boolean }[]>`
    SELECT id, droga_id, es_nombre FROM (
      SELECT 1 AS orden, a.id, a.droga_id, false AS es_nombre
      FROM fsj.droga_alias a
      JOIN fsj.droga d ON d.tenant_id = a.tenant_id AND d.id = a.droga_id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.alias_normalizado = ${aliasNormalizado}::text AND a.fecha_baja IS NULL AND d.fecha_baja IS NULL
      UNION ALL
      SELECT 2, d.id, d.id, true
      FROM fsj.droga d
      WHERE d.tenant_id = ${tenantId}::uuid AND d.fecha_baja IS NULL AND fsj.normalizar_nombre(d.nombre) = fsj.normalizar_nombre(${aliasNormalizado}::text)
    ) t
    ORDER BY orden
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { id: row.id, drogaId: row.droga_id, esNombre: row.es_nombre } : null;
}

/** `texto` = the synonym as written on the list (display); `aliasNormalizado` = its normalized form (match key). */
export async function insertDrogaAlias(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; drogaId: string; aliasNormalizado: string; texto: string; creadoPorId: string },
): Promise<{ id: string }> {
  return tx.drogaAlias.create({ data: input, select: { id: true } });
}

/** The unit catalog (global, DP-39), bajas included and flagged (`vigente: false`): a droga's unidad base may be one, but it is never offered. */
export async function listUnidadesParaLista(tx: Prisma.TransactionClient): Promise<UnidadParaLista[]> {
  const rows = await tx.unidadMedida.findMany({
    orderBy: [{ tipoMagnitud: "asc" }, { factorABase: "desc" }, { codigo: "asc" }],
    select: { id: true, codigo: true, simbolo: true, tipoMagnitud: true, factorABase: true, fechaBaja: true },
  });
  return rows.map((row) => ({
    id: row.id,
    codigo: row.codigo,
    simbolo: row.simbolo,
    tipoMagnitud: row.tipoMagnitud,
    factorABase: row.factorABase.toFixed(),
    vigente: row.fechaBaja === null,
  }));
}

/** Every vigente costo of ONE proveedor (R1: at most one per droga): what the preview compares each row against (R18, R23). */
export async function getCostosVigentesDeProveedor(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string): Promise<VigenteParaLista[]> {
  const rows = await tx.costoProveedor.findMany({
    where: { tenantId, proveedorId, vigenteHasta: null },
    orderBy: [{ drogaId: "asc" }],
    select: {
      id: true,
      drogaId: true,
      precioInformado: true,
      unidadPrecioId: true,
      costoUnitario: true,
      fechaPrecio: true,
      unidadPrecio: { select: { simbolo: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    drogaId: row.drogaId,
    precioInformado: row.precioInformado.toFixed(),
    unidadPrecioId: row.unidadPrecioId,
    unidadPrecioSimbolo: row.unidadPrecio.simbolo,
    costoUnitario: row.costoUnitario.toFixed(),
    fechaPrecio: isoDate(row.fechaPrecio),
  }));
}

// ============================================================================
// Reads
// ============================================================================

/**
 * The tenant's `alicuota_iva_porcentaje` parametro (R7a), with the defensive fallback to `ALICUOTA_IVA_POR_DEFECTO`
 * for a missing or unreadable row (same discipline as modules/entregas/infrastructure/entrega-repository.ts). Reads
 * `fsj.parametro` directly: modules can not reach into modules/parametros' infrastructure.
 */
export async function getAlicuotaIvaPorDefecto(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const row = await tx.parametro.findUnique({ where: { tenantId_clave: { tenantId, clave: "alicuota_iva_porcentaje" } }, select: { valor: true } });
  return parsearAlicuotaIva(row?.valor) ?? ALICUOTA_IVA_POR_DEFECTO;
}

export interface ListCostosVigentesFilter {
  proveedorId?: string;
  drogaId?: string;
  page: number;
  pageSize: number;
}

export interface CostoProveedorListItem {
  id: string;
  drogaId: string;
  drogaNombre: string;
  /** Symbol of the droga's unidad base: what `costoUnitario` is per. */
  drogaUnidadBaseSimbolo: string;
  proveedorId: string;
  proveedorRazonSocial: string;
  /** The proveedor was given de baja: its costo is not used to quote (R26) but stays listed. */
  proveedorDeBaja: boolean;
  precioInformado: string;
  unidadPrecioId: string;
  unidadPrecioSimbolo: string;
  costoUnitario: string;
  /** R7a: percent, and both prices with it. */
  alicuotaIva: string;
  precioInformadoConIva: string;
  costoUnitarioConIva: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
  descripcionProveedor: string | null;
  /** `null` = manual entry. */
  listaPrecioId: string | null;
  listaNombreArchivo: string | null;
  motivo: string | null;
  vigenteDesde: Date;
}

export interface ListCostosVigentesResult {
  items: CostoProveedorListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** The "Vigentes" tab: vigente costos, by droga name then proveedor, one page. */
export async function listCostosVigentes(tx: Prisma.TransactionClient, tenantId: string, filter: ListCostosVigentesFilter): Promise<ListCostosVigentesResult> {
  const where: Prisma.CostoProveedorWhereInput = { tenantId, vigenteHasta: null };
  if (filter.proveedorId) where.proveedorId = filter.proveedorId;
  if (filter.drogaId) where.drogaId = filter.drogaId;

  const total = await tx.costoProveedor.count({ where });
  const rows = await tx.costoProveedor.findMany({
    where,
    orderBy: [{ droga: { nombre: "asc" } }, { proveedor: { razonSocial: "asc" } }, { id: "asc" }],
    skip: (filter.page - 1) * filter.pageSize,
    take: filter.pageSize,
    select: {
      id: true,
      drogaId: true,
      proveedorId: true,
      precioInformado: true,
      unidadPrecioId: true,
      costoUnitario: true,
      alicuotaIva: true,
      precioInformadoConIva: true,
      costoUnitarioConIva: true,
      fechaPrecio: true,
      descripcionProveedor: true,
      listaPrecioId: true,
      motivo: true,
      vigenteDesde: true,
      droga: { select: { nombre: true, unidadBase: { select: { simbolo: true } } } },
      proveedor: { select: { razonSocial: true, fechaBaja: true } },
      unidadPrecio: { select: { simbolo: true } },
      listaPrecio: { select: { nombreArchivo: true } },
    },
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      drogaId: row.drogaId,
      drogaNombre: row.droga.nombre,
      drogaUnidadBaseSimbolo: row.droga.unidadBase.simbolo,
      proveedorId: row.proveedorId,
      proveedorRazonSocial: row.proveedor.razonSocial,
      proveedorDeBaja: row.proveedor.fechaBaja !== null,
      precioInformado: row.precioInformado.toFixed(),
      unidadPrecioId: row.unidadPrecioId,
      unidadPrecioSimbolo: row.unidadPrecio.simbolo,
      costoUnitario: row.costoUnitario.toFixed(),
      alicuotaIva: row.alicuotaIva.toFixed(),
      precioInformadoConIva: row.precioInformadoConIva.toFixed(),
      costoUnitarioConIva: row.costoUnitarioConIva.toFixed(),
      fechaPrecio: isoDate(row.fechaPrecio),
      descripcionProveedor: row.descripcionProveedor,
      listaPrecioId: row.listaPrecioId,
      listaNombreArchivo: row.listaPrecio?.nombreArchivo ?? null,
      motivo: row.motivo,
      vigenteDesde: row.vigenteDesde,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

export interface HistorialCostoItem {
  id: string;
  precioInformado: string;
  unidadPrecioSimbolo: string;
  costoUnitario: string;
  /** R7a: percent, and both prices with it. */
  alicuotaIva: string;
  precioInformadoConIva: string;
  costoUnitarioConIva: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
  descripcionProveedor: string | null;
  listaPrecioId: string | null;
  listaNombreArchivo: string | null;
  motivo: string | null;
  vigenteDesde: Date;
  /** `null` = the vigente version. */
  vigenteHasta: Date | null;
  creadoPorNombre: string;
  creadoPorApellido: string;
  /**
   * The motivo of the baja that closed this version, when it was closed without a replacement. The costo row's own
   * `motivo` is immutable (R2), so a baja's motivo lives only in its audit record (`BAJA` on `costo_proveedor`).
   */
  bajaMotivo: string | null;
}

/** Every version of one (droga, proveedor) pair, newest first (the vigente one on top). */
export async function listHistorialCosto(tx: Prisma.TransactionClient, tenantId: string, drogaId: string, proveedorId: string): Promise<HistorialCostoItem[]> {
  const rows = await tx.costoProveedor.findMany({
    where: { tenantId, drogaId, proveedorId },
    orderBy: [{ vigenteDesde: "desc" }, { vigenteHasta: { sort: "desc", nulls: "first" } }, { id: "asc" }],
    select: {
      id: true,
      precioInformado: true,
      costoUnitario: true,
      alicuotaIva: true,
      precioInformadoConIva: true,
      costoUnitarioConIva: true,
      fechaPrecio: true,
      descripcionProveedor: true,
      listaPrecioId: true,
      motivo: true,
      vigenteDesde: true,
      vigenteHasta: true,
      unidadPrecio: { select: { simbolo: true } },
      listaPrecio: { select: { nombreArchivo: true } },
      creadoPor: { select: { nombre: true, apellido: true } },
    },
  });
  // A baja closes a version with no successor and leaves its motivo only in the audit trail (R11): read it for the closed ones.
  const cerradas = rows.filter((row) => row.vigenteHasta !== null).map((row) => row.id);
  const bajas =
    cerradas.length === 0
      ? []
      : await tx.registroAuditoria.findMany({
          where: { tenantId, entidad: "costo_proveedor", accion: "BAJA", entidadId: { in: cerradas } },
          orderBy: { ocurridoEn: "desc" },
          select: { entidadId: true, motivo: true },
        });
  const motivoBaja = new Map<string, string | null>();
  for (const baja of bajas) if (!motivoBaja.has(baja.entidadId)) motivoBaja.set(baja.entidadId, baja.motivo);

  return rows.map((row) => ({
    id: row.id,
    precioInformado: row.precioInformado.toFixed(),
    unidadPrecioSimbolo: row.unidadPrecio.simbolo,
    costoUnitario: row.costoUnitario.toFixed(),
    alicuotaIva: row.alicuotaIva.toFixed(),
    precioInformadoConIva: row.precioInformadoConIva.toFixed(),
    costoUnitarioConIva: row.costoUnitarioConIva.toFixed(),
    fechaPrecio: isoDate(row.fechaPrecio),
    descripcionProveedor: row.descripcionProveedor,
    listaPrecioId: row.listaPrecioId,
    listaNombreArchivo: row.listaPrecio?.nombreArchivo ?? null,
    motivo: row.motivo,
    vigenteDesde: row.vigenteDesde,
    vigenteHasta: row.vigenteHasta,
    creadoPorNombre: row.creadoPor.nombre,
    creadoPorApellido: row.creadoPor.apellido,
    bajaMotivo: motivoBaja.get(row.id) ?? null,
  }));
}

export interface ListListasPrecioFilter {
  proveedorId?: string;
  page: number;
  pageSize: number;
}

export interface ListaPrecioListItem {
  id: string;
  proveedorId: string;
  proveedorRazonSocial: string;
  formato: string;
  nombreArchivo: string;
  /** `YYYY-MM-DD`. */
  fechaLista: string;
  filasLeidas: number;
  filasAplicadas: number;
  registradoPorNombre: string;
  registradoPorApellido: string;
  registradoEn: Date;
}

export interface ListListasPrecioResult {
  items: ListaPrecioListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** The "Listas importadas" tab: newest first, one page. */
export async function listListasPrecio(tx: Prisma.TransactionClient, tenantId: string, filter: ListListasPrecioFilter): Promise<ListListasPrecioResult> {
  const where: Prisma.ListaPrecioProveedorWhereInput = { tenantId };
  if (filter.proveedorId) where.proveedorId = filter.proveedorId;

  const total = await tx.listaPrecioProveedor.count({ where });
  const rows = await tx.listaPrecioProveedor.findMany({
    where,
    orderBy: [{ registradoEn: "desc" }, { id: "asc" }],
    skip: (filter.page - 1) * filter.pageSize,
    take: filter.pageSize,
    select: {
      id: true,
      proveedorId: true,
      formato: true,
      nombreArchivo: true,
      fechaLista: true,
      filasLeidas: true,
      filasAplicadas: true,
      registradoEn: true,
      proveedor: { select: { razonSocial: true } },
      registradoPor: { select: { nombre: true, apellido: true } },
    },
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      proveedorId: row.proveedorId,
      proveedorRazonSocial: row.proveedor.razonSocial,
      formato: row.formato,
      nombreArchivo: row.nombreArchivo,
      fechaLista: isoDate(row.fechaLista),
      filasLeidas: row.filasLeidas,
      filasAplicadas: row.filasAplicadas,
      registradoPorNombre: row.registradoPor.nombre,
      registradoPorApellido: row.registradoPor.apellido,
      registradoEn: row.registradoEn,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

/** A vigente costo of a droga, with what R26 (`elegirCostoProveedor`) and the cotización snapshot (R32) need. */
export interface CostoProveedorCandidato {
  id: string;
  drogaId: string;
  proveedorId: string;
  proveedorNombre: string;
  /** The proveedor was given de baja: not usable to quote (R26). The row is returned so the caller can tell "no costo" from "only a baja proveedor's". */
  proveedorDeBaja: boolean;
  precioInformado: string;
  unidadPrecioSimbolo: string;
  costoUnitario: string;
  /** R7a: percent, and both prices with it (`costoUnitarioConIva` is what the cotización multiplies). */
  alicuotaIva: string;
  precioInformadoConIva: string;
  costoUnitarioConIva: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
  vigenteDesde: Date;
}

/**
 * Every vigente costo of the given drogas (all proveedores, bajas included
 * and flagged), ordered by (droga, proveedor) so ties in
 * `elegirCostoProveedor` resolve deterministically. ONE query, whatever the
 * number of drogas. Read-only: calculating a cotización never writes here (R34).
 */
export async function getCostosProveedorVigentesDeDrogas(tx: Prisma.TransactionClient, tenantId: string, drogaIds: readonly string[]): Promise<CostoProveedorCandidato[]> {
  if (drogaIds.length === 0) return [];
  const rows = await tx.costoProveedor.findMany({
    where: { tenantId, vigenteHasta: null, drogaId: { in: [...new Set(drogaIds)] } },
    orderBy: [{ drogaId: "asc" }, { proveedorId: "asc" }],
    select: {
      id: true,
      drogaId: true,
      proveedorId: true,
      precioInformado: true,
      costoUnitario: true,
      alicuotaIva: true,
      precioInformadoConIva: true,
      costoUnitarioConIva: true,
      fechaPrecio: true,
      vigenteDesde: true,
      proveedor: { select: { razonSocial: true, fechaBaja: true } },
      unidadPrecio: { select: { simbolo: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    drogaId: row.drogaId,
    proveedorId: row.proveedorId,
    proveedorNombre: row.proveedor.razonSocial,
    proveedorDeBaja: row.proveedor.fechaBaja !== null,
    precioInformado: row.precioInformado.toFixed(),
    unidadPrecioSimbolo: row.unidadPrecio.simbolo,
    costoUnitario: row.costoUnitario.toFixed(),
    alicuotaIva: row.alicuotaIva.toFixed(),
    precioInformadoConIva: row.precioInformadoConIva.toFixed(),
    costoUnitarioConIva: row.costoUnitarioConIva.toFixed(),
    fechaPrecio: isoDate(row.fechaPrecio),
    vigenteDesde: row.vigenteDesde,
  }));
}
