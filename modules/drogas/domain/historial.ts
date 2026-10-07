/**
 * Pure derivation for the droga "Historial" view (docs/specs/historial-droga.md):
 * every receta that CONSUMED a droga (EGRESO_PREPARACION movements of its
 * partidas, reached through preparacion -> item_receta -> receta) and the
 * partida(s) each one came from. No I/O, no Prisma (eslint's
 * domainBoundaryPatterns enforce this).
 *
 * Data flow (same as the proveedor Trayectoria):
 *   infrastructure/historial-repository.ts  ->  `HistorialDrogaCruda` (raw rows)
 *   application/get-historial-droga.ts      ->  `armarHistorialDroga()` (this file)
 *   ui/historial-*.tsx                      ->  renders `HistorialDroga`
 *
 * Optional pieces (paciente name) arrive EMPTY when the session cannot see
 * them (the repository does not even query them); `AccesoHistorialDroga` tells
 * the UI what to render, so "no data" and "not allowed" are never confused.
 *
 * No free-text field and no paciente data is ever logged from here.
 */
import { formatFecha } from "@/shared/format/fecha";
import { uuid } from "@/shared/validation";

// ============================================================================
// Constants
// ============================================================================

/** Recetas per page of the Historial (spec is silent; see plan D3). */
export const PAGE_SIZE_HISTORIAL_DROGA = 20;

/** Upper bound of the `?page=` value accepted by the use case; callers clamp to it (the repository then clamps to the last real page). */
export const PAGE_MAX_HISTORIAL_DROGA = 100_000;

/** Most partidas the filter accepts at once (URL parsing and use case input are both capped to it). */
export const PARTIDAS_FILTRO_MAX = 20;

// ============================================================================
// Access
// ============================================================================

/**
 * Derived from the session's permisos by the use case (`can()`), then used
 * twice: the repository only loads what is `true`, and the UI only renders
 * (and links to) what is `true`.
 */
export interface AccesoHistorialDroga {
  /** `pacientes.gestionar`: the paciente name column (otherwise "—"). */
  pacientes: boolean;
  /** `stock.ver`: link to /stock/partidas/[id] AND the unit-catalog conversion of quantities. */
  stock: boolean;
}

// ============================================================================
// Raw input (what the repository reads)
// ============================================================================

export interface DrogaHistorial {
  id: string;
  nombre: string;
  fechaBaja: Date | null;
  /** The unidad base every quantity of this view is expressed in. */
  unidadBaseId: string;
  unidadBaseSimbolo: string;
}

/** A partida of the droga that has at least one EGRESO_PREPARACION: one option of the filter. */
export interface PartidaOpcion {
  id: string;
  lote: string;
  /** Razón social. */
  proveedor: string;
  /** Postgres `date` (UTC midnight); `null` = does not expire (an insumo). */
  fechaVencimiento: Date | null;
}

export interface RecetaConsumoCruda {
  id: string;
  /** `numero_interno` is a bigint: read as text. */
  numeroInterno: string;
  /** `receta.estado` as text (an ANULADA receta still shows: the stock was consumed). */
  estado: string;
  /** Latest `preparacion.confirmada_en` among the droga's movements of this receta. */
  preparadaEn: Date | null;
  /** SQL `SUM(movimiento_stock.cantidad)`, decimal string, droga unidad base. */
  consumido: string;
  medicoApellido: string;
  medicoNombre: string;
}

export interface PacienteRecetaCrudo {
  recetaId: string;
  apellido: string;
  nombre: string;
}

export interface PartidaConsumidaCruda {
  recetaId: string;
  partidaId: string;
  lote: string;
  proveedor: string;
  fechaVencimiento: Date | null;
  /** SQL `SUM(cantidad)` of this receta from this partida, decimal string. */
  cantidad: string;
}

export interface HistorialDrogaCruda {
  droga: DrogaHistorial;
  zonaHoraria: string;
  /** The droga's partidas with at least one egreso, newest ingreso first: the filter's options. */
  partidasDisponibles: PartidaOpcion[];
  /** The filter actually applied: the requested ids that belong to `partidasDisponibles`. Empty = no filter. */
  partidaIds: string[];
  /** Recetas that consumed the droga, ignoring the filter. */
  totalRecetas: number;
  /** Recetas matching the filter (= `totalRecetas` without a filter). Drives the pagination. */
  totalFiltradas: number;
  /** Requested page, already clamped to the last real page. */
  page: number;
  recetas: RecetaConsumoCruda[];
  /** Empty unless `acceso.pacientes`. */
  pacientes: PacienteRecetaCrudo[];
  partidasConsumidas: PartidaConsumidaCruda[];
}

// ============================================================================
// View model (what the UI renders)
// ============================================================================

export interface PartidaConsumida {
  partidaId: string;
  lote: string;
  proveedor: string;
  fechaVencimiento: Date | null;
  cantidad: string;
}

export interface RecetaHistorial {
  id: string;
  numeroInterno: string;
  estado: string;
  preparadaEn: Date | null;
  /** "Apellido, Nombre". */
  medico: string;
  /** "Apellido, Nombre"; `null` without `pacientes.gestionar` (or without a row). */
  paciente: string | null;
  consumido: string;
  partidas: PartidaConsumida[];
}

export interface PaginacionHistorialDroga {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface HistorialDroga {
  droga: DrogaHistorial;
  acceso: AccesoHistorialDroga;
  zonaHoraria: string;
  /** The filter's options (newest ingreso first). */
  partidasDisponibles: PartidaOpcion[];
  /** The filter in effect (ids that belong to `partidasDisponibles`); empty = no filter. */
  partidaIds: string[];
  /** Recetas of the droga ignoring the filter (the "de M" of the count line). */
  totalRecetas: number;
  recetas: RecetaHistorial[];
  /** Over the FILTERED recetas (`total`). */
  paginacion: PaginacionHistorialDroga;
}

// ============================================================================
// Pagination
// ============================================================================

/** Clamps `page` into `[1, totalPages]` (an empty result still has one page). */
export function calcularPaginacion(total: number, page: number, pageSize: number = PAGE_SIZE_HISTORIAL_DROGA): PaginacionHistorialDroga {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Math.max(1, page), totalPages), pageSize, total, totalPages };
}

// ============================================================================
// Filter by partida
// ============================================================================

/**
 * The `partida` search param (`string | string[] | undefined`; one entry per
 * repeated `?partida=a&partida=b`) as a clean id list: only valid uuids (the
 * shared zod `uuid`), lowercased (Postgres prints uuids in lowercase and ids
 * are compared as strings), deduplicated in first-seen order and capped to
 * `PARTIDAS_FILTRO_MAX`. Anything else is dropped silently, never an error.
 * Whether an id belongs to the droga is NOT decided here
 * (see `filtrarPartidasDeLaDroga`).
 */
export function parsearPartidaIds(raw: string | readonly string[] | undefined): string[] {
  const lista = raw === undefined ? [] : typeof raw === "string" ? [raw] : raw;
  const ids = new Set<string>();
  for (const valor of lista) {
    if (ids.size >= PARTIDAS_FILTRO_MAX) break;
    if (typeof valor === "string" && uuid.safeParse(valor).success) ids.add(valor.toLowerCase());
  }
  return [...ids];
}

/** Keeps only the requested ids that are one of the droga's own option partidas: the filter is never trusted, an unknown id is ignored. */
export function filtrarPartidasDeLaDroga(ids: readonly string[], disponibles: readonly PartidaOpcion[]): string[] {
  const propias = new Set(disponibles.map((p) => p.id));
  return ids.filter((id) => propias.has(id));
}

/** The selected partidas in the order of `disponibles`, so the chips never reshuffle when the URL's order changes. */
export function partidasSeleccionadas(disponibles: readonly PartidaOpcion[], ids: readonly string[]): PartidaOpcion[] {
  const elegidas = new Set(ids);
  return disponibles.filter((p) => elegidas.has(p.id));
}

/** What the autocomplete still offers: the available partidas minus the already selected ones. */
export function partidasRestantes(disponibles: readonly PartidaOpcion[], ids: readonly string[]): PartidaOpcion[] {
  const elegidas = new Set(ids);
  return disponibles.filter((p) => !elegidas.has(p.id));
}

/** `Lote <lote> · <proveedor> · vence dd/mm/aaaa` (insumos without vencimiento: "sin vencimiento"). */
export function etiquetaPartidaOpcion(partida: PartidaOpcion): string {
  const vencimiento = partida.fechaVencimiento ? `vence ${formatFecha(partida.fechaVencimiento)}` : "sin vencimiento";
  return `Lote ${partida.lote} · ${partida.proveedor} · ${vencimiento}`;
}

/** The historial URL for a filter (and optionally a page): repeated `partida`, `page` only past the first page. Shared by the filter control and the pagination links. */
export function hrefHistorialDroga(baseHref: string, partidaIds: readonly string[], page?: number): string {
  const qs = new URLSearchParams();
  for (const id of partidaIds) qs.append("partida", id);
  if (page !== undefined && page > 1) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `${baseHref}?${query}` : baseHref;
}

// ============================================================================
// Assembly
// ============================================================================

function apellidoNombre(apellido: string, nombre: string): string {
  return `${apellido}, ${nombre}`;
}

/**
 * Shapes the raw rows into the view model. The paciente name is built ONLY when
 * `acceso.pacientes` allows it, even if the caller handed in rows for it
 * (defense in depth: the repository already skips the query).
 */
export function armarHistorialDroga(cruda: HistorialDrogaCruda, acceso: AccesoHistorialDroga): HistorialDroga {
  const pacientes = new Map<string, string>(acceso.pacientes ? cruda.pacientes.map((p) => [p.recetaId, apellidoNombre(p.apellido, p.nombre)] as const) : []);

  const consumidas = new Map<string, PartidaConsumida[]>();
  for (const c of cruda.partidasConsumidas) {
    const item: PartidaConsumida = { partidaId: c.partidaId, lote: c.lote, proveedor: c.proveedor, fechaVencimiento: c.fechaVencimiento, cantidad: c.cantidad };
    const lista = consumidas.get(c.recetaId);
    if (lista) lista.push(item);
    else consumidas.set(c.recetaId, [item]);
  }

  const recetas: RecetaHistorial[] = cruda.recetas.map((r) => ({
    id: r.id,
    numeroInterno: r.numeroInterno,
    estado: r.estado,
    preparadaEn: r.preparadaEn,
    medico: apellidoNombre(r.medicoApellido, r.medicoNombre),
    paciente: pacientes.get(r.id) ?? null,
    consumido: r.consumido,
    partidas: consumidas.get(r.id) ?? [],
  }));

  return {
    droga: cruda.droga,
    acceso,
    zonaHoraria: cruda.zonaHoraria,
    partidasDisponibles: cruda.partidasDisponibles,
    partidaIds: cruda.partidaIds,
    totalRecetas: cruda.totalRecetas,
    recetas,
    paginacion: calcularPaginacion(cruda.totalFiltradas, cruda.page),
  };
}
