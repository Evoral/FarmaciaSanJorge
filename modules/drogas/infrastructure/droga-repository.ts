/**
 * Prisma-backed access to `fsj.droga` for M06 (FASE 4 point 4.2). Every
 * function runs inside an ALREADY OPEN tenant transaction (`tx`, handed in
 * by `shared/usecase.ts`) -- nothing here opens its own transaction. The DB
 * is authoritative for `es_controlada = (tipo_control <> 'NINGUNO')`, the
 * vigente-name uniqueness (accent/case-insensitive, partial -- migration
 * 0067; names vs synonyms: INV-DRG-002), and INV-F03 (never deleted) -- see
 * migrations 0007 and 0067. Name searches go through
 * `shared/db/busqueda-droga.ts` (name OR vigente synonym, accent-insensitive).
 * `tenantId` is an explicit, defense-in-depth filter on top of RLS
 * everywhere (same discipline as usuario-repository.ts).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { ClaseDroga as PrismaClaseDroga, TipoControl as PrismaTipoControl } from "@/generated/prisma/enums";
import { buscarDrogasPorTexto, listSinonimosVigentes } from "@/shared/db/busqueda-droga";
import type { ConflictoNombreDroga } from "../domain/sinonimo";

// ============================================================================
// Stock (fsj.v_stock_droga, migration 0008/0025) -- read-only, NOT a Prisma
// model (it's a plain SQL view). "NO HACER" (plan §9 M07): never sum
// partida.cantidad_disponible in application code when this view exists.
// ============================================================================

async function loadStockPorDroga(tx: Prisma.TransactionClient, tenantId: string): Promise<Map<string, string>> {
  const rows = await tx.$queryRaw<{ droga_id: string; stock_disponible: string }[]>`
    SELECT droga_id, stock_disponible::text FROM fsj.v_stock_droga WHERE tenant_id = ${tenantId}::uuid
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
  /** Migration 0063. */
  clase?: PrismaClaseDroga;
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
  clase: PrismaClaseDroga;
  stockMinimo: string;
  stockDisponible: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
  /** Vigente synonyms, as typed (docs/specs/sinonimos-droga.md). */
  sinonimos: string[];
  /** The synonym the search matched through, when the name itself did not match. */
  sinonimoCoincidente: string | null;
}

export interface ListDrogasResult {
  items: DrogaListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** `coincidencias` = the search's matches (droga id -> matched synonym), `null` when there is no search. */
function buildWhere(filter: ListDrogasFilter, coincidencias: Map<string, string | null> | null): Prisma.DrogaWhereInput {
  const where: Prisma.DrogaWhereInput = { tenantId: filter.tenantId };

  if (coincidencias) where.id = { in: [...coincidencias.keys()] };
  if (filter.soloControladas === true) where.esControlada = true;
  if (filter.clase) where.clase = filter.clase;
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
  const search = filter.search?.trim() ?? "";
  // Name OR vigente synonym, accent-insensitive (docs/specs/sinonimos-droga.md); the other filters stay a Prisma WHERE.
  const coincidencias = search.length > 0 ? await buscarDrogasPorTexto(tx, filter.tenantId, search) : null;
  const where = buildWhere(filter, coincidencias);
  const stock = await loadStockPorDroga(tx, filter.tenantId);
  const extras = async (ids: string[]) => {
    const sinonimos = await listSinonimosVigentes(tx, filter.tenantId, ids);
    return (id: string) => ({ sinonimos: sinonimos.get(id) ?? [], sinonimoCoincidente: coincidencias?.get(id) ?? null });
  };

  if (filter.bajoMinimo === true) {
    const rows = await tx.droga.findMany({
      where,
      orderBy: [{ nombre: "asc" }],
      select: { id: true, nombre: true, unidadBaseId: true, esControlada: true, tipoControl: true, clase: true, stockMinimo: true, fechaBaja: true, motivoBaja: true, unidadBase: { select: { simbolo: true } } },
    });
    const withStock = rows
      .map((row) => ({ row, disponible: Number(stock.get(row.id) ?? "0") }))
      .filter(({ row, disponible }) => disponible < Number(row.stockMinimo.toString()));

    const total = withStock.length;
    const skip = (filter.page - 1) * filter.pageSize;
    const page = withStock.slice(skip, skip + filter.pageSize);
    const extrasDe = await extras(page.map(({ row }) => row.id));

    return {
      items: page.map(({ row }) => ({
        id: row.id,
        nombre: row.nombre,
        unidadBaseId: row.unidadBaseId,
        unidadBaseSimbolo: row.unidadBase.simbolo,
        esControlada: row.esControlada,
        tipoControl: row.tipoControl,
        clase: row.clase,
        stockMinimo: row.stockMinimo.toString(),
        stockDisponible: stock.get(row.id) ?? "0",
        fechaBaja: row.fechaBaja,
        motivoBaja: row.motivoBaja,
        ...extrasDe(row.id),
      })),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  const skip = (filter.page - 1) * filter.pageSize;
  const total = await tx.droga.count({ where });
  const rows = await tx.droga.findMany({
    where,
    orderBy: [{ nombre: "asc" }],
    skip,
    take: filter.pageSize,
    select: { id: true, nombre: true, unidadBaseId: true, esControlada: true, tipoControl: true, clase: true, stockMinimo: true, fechaBaja: true, motivoBaja: true, unidadBase: { select: { simbolo: true } } },
  });
  const extrasDe = await extras(rows.map((row) => row.id));

  return {
    items: rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      unidadBaseId: row.unidadBaseId,
      unidadBaseSimbolo: row.unidadBase.simbolo,
      esControlada: row.esControlada,
      tipoControl: row.tipoControl,
      clase: row.clase,
      stockMinimo: row.stockMinimo.toString(),
      stockDisponible: stock.get(row.id) ?? "0",
      fechaBaja: row.fechaBaja,
      motivoBaja: row.motivoBaja,
      ...extrasDe(row.id),
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
  clase: PrismaClaseDroga;
  stockMinimo: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

export async function getDrogaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<DrogaParaAccion | null> {
  const row = await tx.droga.findUnique({
    where: { id, tenantId },
    select: { id: true, nombre: true, unidadBaseId: true, densidad: true, esControlada: true, tipoControl: true, clase: true, stockMinimo: true, fechaBaja: true, motivoBaja: true },
  });
  if (!row) return null;
  return { ...row, densidad: row.densidad?.toString() ?? null, stockMinimo: row.stockMinimo.toString() };
}

/**
 * Who already holds `nombre` in the SAME tenant, compared after
 * `fsj.normalizar_nombre` (accents/case/whitespace ignored): a vigente
 * droga other than `excludeId` (by its name), or a vigente synonym of ANY
 * droga (`excludeId`'s own included). `null` = free. Mirrors what the DB
 * enforces (migration 0067: uq_droga_nombre_normalizado_vigente,
 * uq_droga_alias_vigente, INV-DRG-002) so callers answer with a readable
 * message (`mensajeConflictoNombre`) before the DB would refuse. A name
 * held by a droga is reported as such first.
 */
export async function existeNombreVigente(tx: Prisma.TransactionClient, tenantId: string, nombre: string, excludeId?: string): Promise<ConflictoNombreDroga | null> {
  const excluir = excludeId ?? null;
  const rows = await tx.$queryRaw<{ tipo: "droga" | "sinonimo"; droga_id: string; droga_nombre: string; sinonimo: string | null }[]>`
    SELECT tipo, droga_id, droga_nombre, sinonimo FROM (
      SELECT 1 AS orden, 'droga' AS tipo, d.id AS droga_id, d.nombre::text AS droga_nombre, NULL::text AS sinonimo
      FROM fsj.droga d
      WHERE d.tenant_id = ${tenantId}::uuid
        AND d.fecha_baja IS NULL
        AND fsj.normalizar_nombre(d.nombre) = fsj.normalizar_nombre(${nombre}::text)
        AND (${excluir}::uuid IS NULL OR d.id <> ${excluir}::uuid)
      UNION ALL
      SELECT 2, 'sinonimo', d.id, d.nombre::text, a.texto
      FROM fsj.droga_alias a
      JOIN fsj.droga d ON d.tenant_id = a.tenant_id AND d.id = a.droga_id
      WHERE a.tenant_id = ${tenantId}::uuid
        AND a.fecha_baja IS NULL
        AND fsj.normalizar_nombre(a.alias_normalizado) = fsj.normalizar_nombre(${nombre}::text)
    ) t
    ORDER BY orden
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return row.tipo === "droga"
    ? { tipo: "droga", drogaId: row.droga_id, drogaNombre: row.droga_nombre }
    : { tipo: "sinonimo", drogaId: row.droga_id, drogaNombre: row.droga_nombre, sinonimo: row.sinonimo ?? "" };
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
  clase: PrismaClaseDroga;
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
      clase: input.clase,
      stockMinimo: input.stockMinimo,
    },
    select: { id: true },
  });
}

export interface EditarDrogaInput {
  id: string;
  nombre: string;
  stockMinimo: string;
  /** Migration 0063: editable at any time (not part of DP-12's classification). */
  clase: PrismaClaseDroga;
  /** Present only when DP-12 allows the change (no partidas yet) -- see editar-droga.ts. */
  clasificacion?: { unidadBaseId: string; esControlada: boolean; tipoControl: PrismaTipoControl };
}

export interface EditarDrogaVersion {
  nombre: string;
  unidadBaseId: string;
  esControlada: boolean;
  tipoControl: PrismaTipoControl;
  clase: PrismaClaseDroga;
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
      clase: version.clase,
      stockMinimo: version.stockMinimo,
    },
    data: {
      nombre: input.nombre,
      clase: input.clase,
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

export interface DrogaOpcion {
  id: string;
  nombre: string;
  unidadBaseId: string;
  /** `tipo_magnitud` of the unidad base: lets a unit picker (e.g. `/stock/ingresar`'s "Unidad de compra") offer only convertible units. */
  tipoMagnitud: string;
  clase: PrismaClaseDroga;
  /** Vigente synonyms, as typed: client-filtered pickers search them too (docs/specs/sinonimos-droga.md). */
  sinonimos: string[];
}

/** Every vigente droga of the tenant, with its unidad base and synonyms -- feeds client-filtered pickers (no pagination, no stock join: see list-drogas-opciones.ts). */
export async function listDrogasOpciones(tx: Prisma.TransactionClient, tenantId: string): Promise<DrogaOpcion[]> {
  const rows = await tx.droga.findMany({
    where: { tenantId, fechaBaja: null },
    orderBy: [{ nombre: "asc" }],
    select: { id: true, nombre: true, unidadBaseId: true, clase: true, unidadBase: { select: { tipoMagnitud: true } } },
  });
  const sinonimos = await listSinonimosVigentes(tx, tenantId);
  return rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    unidadBaseId: row.unidadBaseId,
    tipoMagnitud: row.unidadBase.tipoMagnitud,
    clase: row.clase,
    sinonimos: sinonimos.get(row.id) ?? [],
  }));
}

/** unidad id -> "gramo (g)", for audit rows. Global catalog (DP-39): no tenant filter; includes unidades given de baja. */
export async function getEtiquetasUnidades(tx: Prisma.TransactionClient, unidadIds: string[]): Promise<Map<string, string>> {
  const rows = await tx.unidadMedida.findMany({ where: { id: { in: [...new Set(unidadIds)] } }, select: { id: true, nombre: true, simbolo: true } });
  return new Map(rows.map((u) => [u.id, `${u.nombre} (${u.simbolo})`]));
}
