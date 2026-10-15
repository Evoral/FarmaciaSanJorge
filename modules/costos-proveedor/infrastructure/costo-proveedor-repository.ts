/**
 * Prisma-backed access to `fsj.costo_proveedor` and `fsj.lista_precio_proveedor`
 * (migration 0079, docs/specs/costos-proveedor.md). Every function runs inside
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
      fecha_precio: string;
      vigente_desde: Date;
    }[]
  >`
    SELECT c.id, c.droga_id, c.proveedor_id, c.precio_informado::text AS precio_informado, c.unidad_precio_id,
           c.costo_unitario::text AS costo_unitario, to_char(c.fecha_precio, 'YYYY-MM-DD') AS fecha_precio, c.vigente_desde
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
    fechaPrecio: row.fecha_precio,
    vigenteDesde: row.vigente_desde,
  }));
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
  formato: "XLSX" | "PDF";
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

// ============================================================================
// Reads
// ============================================================================

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
  proveedorId: string;
  proveedorRazonSocial: string;
  /** The proveedor was given de baja: its costo is not used to quote (R26) but stays listed. */
  proveedorDeBaja: boolean;
  precioInformado: string;
  unidadPrecioId: string;
  unidadPrecioSimbolo: string;
  costoUnitario: string;
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
      fechaPrecio: true,
      descripcionProveedor: true,
      listaPrecioId: true,
      motivo: true,
      vigenteDesde: true,
      droga: { select: { nombre: true } },
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
      proveedorId: row.proveedorId,
      proveedorRazonSocial: row.proveedor.razonSocial,
      proveedorDeBaja: row.proveedor.fechaBaja !== null,
      precioInformado: row.precioInformado.toFixed(),
      unidadPrecioId: row.unidadPrecioId,
      unidadPrecioSimbolo: row.unidadPrecio.simbolo,
      costoUnitario: row.costoUnitario.toFixed(),
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
  return rows.map((row) => ({
    id: row.id,
    precioInformado: row.precioInformado.toFixed(),
    unidadPrecioSimbolo: row.unidadPrecio.simbolo,
    costoUnitario: row.costoUnitario.toFixed(),
    fechaPrecio: isoDate(row.fechaPrecio),
    descripcionProveedor: row.descripcionProveedor,
    listaPrecioId: row.listaPrecioId,
    listaNombreArchivo: row.listaPrecio?.nombreArchivo ?? null,
    motivo: row.motivo,
    vigenteDesde: row.vigenteDesde,
    vigenteHasta: row.vigenteHasta,
    creadoPorNombre: row.creadoPor.nombre,
    creadoPorApellido: row.creadoPor.apellido,
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
    fechaPrecio: isoDate(row.fechaPrecio),
    vigenteDesde: row.vigenteDesde,
  }));
}
