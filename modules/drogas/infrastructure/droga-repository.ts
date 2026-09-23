/**
 * Prisma-backed access to `fsj.droga` for M06 (FASE 4 point 4.2). Every
 * function runs inside an ALREADY OPEN tenant transaction (`tx`, handed in
 * by `shared/usecase.ts`) -- nothing here opens its own transaction. The DB
 * is authoritative for `es_controlada = (tipo_control <> 'NINGUNO')`, the
 * vigente-name uniqueness (citext, partial), and INV-F03 (never deleted) --
 * see migration 0007. `tenantId` is an explicit, defense-in-depth filter on
 * top of RLS everywhere (same discipline as usuario-repository.ts).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { TipoControl as PrismaTipoControl } from "@/generated/prisma/enums";

// ============================================================================
// Stock (fsj.v_stock_droga, migration 0008/0025) -- read-only, NOT a Prisma
// model (it's a plain SQL view). "NO HACER" (plan §9 M07): never sum
// partida.cantidad_disponible in application code when this view exists.
// ============================================================================

async function loadStockPorDroga(tx: Prisma.TransactionClient, tenantId: string): Promise<Map<string, string>> {
  const rows = await tx.$queryRaw<{ droga_id: string; stock_disponible: string }[]>`
    SELECT droga_id, stock_disponible FROM fsj.v_stock_droga WHERE tenant_id = ${tenantId}::uuid
  `;
  return new Map(rows.map((row) => [row.droga_id, row.stock_disponible]));
}

// ============================================================================
// Listing (4.2: search + soloControladas + bajoMinimo + soloVigentes + pagination)
// ============================================================================

export interface ListDrogasFilter {
  tenantId: string;
  search?: string;
  soloControladas?: boolean;
  /** `true` = only drogas whose stock_disponible < stock_minimo. */
  bajoMinimo?: boolean;
  soloVigentes?: boolean;
  page: number;
  pageSize: number;
}

export interface DrogaListItem {
  id: string;
  nombre: string;
  unidadBaseId: string;
  unidadBaseSimbolo: string;
  esControlada: boolean;
  tipoControl: PrismaTipoControl;
  stockMinimo: string;
  stockDisponible: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export interface ListDrogasResult {
  items: DrogaListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function buildWhere(filter: ListDrogasFilter): Prisma.DrogaWhereInput {
  const where: Prisma.DrogaWhereInput = { tenantId: filter.tenantId };

  if (filter.search && filter.search.trim().length > 0) {
    where.nombre = { contains: filter.search.trim(), mode: "insensitive" };
  }
  if (filter.soloControladas === true) where.esControlada = true;
  if (filter.soloVigentes === true) where.fechaBaja = null;
  else if (filter.soloVigentes === false) where.fechaBaja = { not: null };

  return where;
}

/**
 * `bajoMinimo` cannot be expressed as a `fsj.droga` WHERE clause (stock lives
 * in a separate view, joined in JS below) -- so when it is requested, this
 * loads every row matching the OTHER filters (no DB-side pagination), joins
 * stock, filters, and paginates the resulting array in memory. Acceptable
 * for this internal tool's scale (a pharmacy's droga catalog: low hundreds
 * of rows at most) -- documented tradeoff rather than a dynamic raw-SQL
 * fragment builder for one filter combination.
 */
export async function listDrogas(tx: Prisma.TransactionClient, filter: ListDrogasFilter): Promise<ListDrogasResult> {
  const where = buildWhere(filter);
  const stock = await loadStockPorDroga(tx, filter.tenantId);

  if (filter.bajoMinimo === true) {
    const rows = await tx.droga.findMany({
      where,
      orderBy: [{ nombre: "asc" }],
      select: { id: true, nombre: true, unidadBaseId: true, esControlada: true, tipoControl: true, stockMinimo: true, fechaBaja: true, motivoBaja: true, unidadBase: { select: { simbolo: true } } },
    });
    const withStock = rows
      .map((row) => ({ row, disponible: Number(stock.get(row.id) ?? "0") }))
      .filter(({ row, disponible }) => disponible < Number(row.stockMinimo.toString()));

    const total = withStock.length;
    const skip = (filter.page - 1) * filter.pageSize;
    const page = withStock.slice(skip, skip + filter.pageSize);

    return {
      items: page.map(({ row }) => ({
        id: row.id,
        nombre: row.nombre,
        unidadBaseId: row.unidadBaseId,
        unidadBaseSimbolo: row.unidadBase.simbolo,
        esControlada: row.esControlada,
        tipoControl: row.tipoControl,
        stockMinimo: row.stockMinimo.toString(),
        stockDisponible: stock.get(row.id) ?? "0",
        fechaBaja: row.fechaBaja,
        motivoBaja: row.motivoBaja,
      })),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  const skip = (filter.page - 1) * filter.pageSize;
  const [total, rows] = await Promise.all([
    tx.droga.count({ where }),
    tx.droga.findMany({
      where,
      orderBy: [{ nombre: "asc" }],
      skip,
      take: filter.pageSize,
      select: { id: true, nombre: true, unidadBaseId: true, esControlada: true, tipoControl: true, stockMinimo: true, fechaBaja: true, motivoBaja: true, unidadBase: { select: { simbolo: true } } },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      unidadBaseId: row.unidadBaseId,
      unidadBaseSimbolo: row.unidadBase.simbolo,
      esControlada: row.esControlada,
      tipoControl: row.tipoControl,
      stockMinimo: row.stockMinimo.toString(),
      stockDisponible: stock.get(row.id) ?? "0",
      fechaBaja: row.fechaBaja,
      motivoBaja: row.motivoBaja,
    })),
    total,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

// ============================================================================
// Read for action handlers
// ============================================================================

export interface DrogaParaAccion {
  id: string;
  nombre: string;
  unidadBaseId: string;
  densidad: string | null;
  esControlada: boolean;
  tipoControl: PrismaTipoControl;
  stockMinimo: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export async function getDrogaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<DrogaParaAccion | null> {
  const row = await tx.droga.findUnique({
    where: { id, tenantId },
    select: { id: true, nombre: true, unidadBaseId: true, densidad: true, esControlada: true, tipoControl: true, stockMinimo: true, fechaBaja: true, motivoBaja: true },
  });
  if (!row) return null;
  return { ...row, densidad: row.densidad?.toString() ?? null, stockMinimo: row.stockMinimo.toString() };
}

/** `true` if some OTHER (non-baja OR baja -- the DB's own partial unique index only excludes baja rows, mirrored here) droga in the SAME tenant already has this nombre. */
export async function existeNombreVigente(tx: Prisma.TransactionClient, tenantId: string, nombre: string, excludeId?: string): Promise<boolean> {
  const row = await tx.droga.findFirst({
    where: { tenantId, nombre: { equals: nombre, mode: "insensitive" }, fechaBaja: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return row !== null;
}

/** DP-12 (conservative, task's binding decision): a droga with ANY partida cannot change esControlada/tipoControl/unidadBaseId. */
export async function tieneAlgunaPartida(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<boolean> {
  const row = await tx.partida.findFirst({ where: { tenantId, drogaId }, select: { id: true } });
  return row !== null;
}

/**
 * M1/M3 (review findings): locks the target droga row (`SELECT ... FOR
 * UPDATE`) BEFORE any caller reads its current state -- same discipline as
 * `modules/usuarios/infrastructure/admin-guard.ts`'s header comment
 * ("lock rows in one ordered statement, then decide from a FRESH read").
 * `editar-droga.ts` additionally relies on this for DP-12: once this
 * returns, migration 0028's `trg_droga_validar_clasificacion_inmutable`
 * guarantees no concurrent partida INSERT can commit against this droga
 * until this transaction ends (see that migration's lock-conflict
 * reasoning) -- so a `tieneAlgunaPartida` read taken AFTER this lock is
 * never stale. Returns `false` when no row matches (id not found, or not
 * visible to this tenant).
 */
export async function lockDrogaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.droga WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

// ============================================================================
// Writes
// ============================================================================

export interface NuevaDrogaInput {
  tenantId: string;
  nombre: string;
  unidadBaseId: string;
  esControlada: boolean;
  tipoControl: PrismaTipoControl;
  stockMinimo: string;
}

export async function insertDroga(tx: Prisma.TransactionClient, input: NuevaDrogaInput): Promise<{ id: string }> {
  return tx.droga.create({
    data: {
      tenantId: input.tenantId,
      nombre: input.nombre,
      unidadBaseId: input.unidadBaseId,
      esControlada: input.esControlada,
      tipoControl: input.tipoControl,
      stockMinimo: input.stockMinimo,
    },
    select: { id: true },
  });
}

export interface EditarDrogaInput {
  id: string;
  nombre: string;
  stockMinimo: string;
  /** Present only when DP-12 allows the change (no partidas yet) -- see editar-droga.ts. */
  clasificacion?: { unidadBaseId: string; esControlada: boolean; tipoControl: PrismaTipoControl };
}

export interface EditarDrogaVersion {
  nombre: string;
  unidadBaseId: string;
  esControlada: boolean;
  tipoControl: PrismaTipoControl;
  stockMinimo: string;
}

export async function updateDrogaDatos(tx: Prisma.TransactionClient, tenantId: string, input: EditarDrogaInput, version: EditarDrogaVersion): Promise<boolean> {
  const result = await tx.droga.updateMany({
    where: {
      id: input.id,
      tenantId,
      nombre: version.nombre,
      unidadBaseId: version.unidadBaseId,
      esControlada: version.esControlada,
      tipoControl: version.tipoControl,
      stockMinimo: version.stockMinimo,
    },
    data: {
      nombre: input.nombre,
      stockMinimo: input.stockMinimo,
      ...(input.clasificacion
        ? { unidadBaseId: input.clasificacion.unidadBaseId, esControlada: input.clasificacion.esControlada, tipoControl: input.clasificacion.tipoControl }
        : {}),
    },
  });
  return result.count === 1;
}

export interface CambiarBajaDrogaInput {
  tenantId: string;
  id: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export async function cambiarBajaDroga(tx: Prisma.TransactionClient, input: CambiarBajaDrogaInput): Promise<void> {
  await tx.droga.update({
    where: { id: input.id, tenantId: input.tenantId },
    data: { fechaBaja: input.fechaBaja, motivoBaja: input.motivoBaja },
  });
}

// ============================================================================
// Unit picker (global catalog, vigentes only -- for the crear/editar droga form)
// ============================================================================

export interface UnidadOpcion {
  id: string;
  nombre: string;
  simbolo: string;
  tipoMagnitud: string;
}

export async function listUnidadesVigentes(tx: Prisma.TransactionClient): Promise<UnidadOpcion[]> {
  const rows = await tx.unidadMedida.findMany({
    where: { fechaBaja: null },
    orderBy: [{ tipoMagnitud: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, simbolo: true, tipoMagnitud: true },
  });
  return rows;
}
