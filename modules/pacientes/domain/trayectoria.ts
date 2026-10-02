/**
 * Pure derivation for the paciente "Trayectoria" view
 * (docs/specs/trayectoria-paciente.md): everything a paciente went through,
 * receta by receta -- Ingreso -> Preparación -> Libro -> Entrega -> Archivo.
 * No I/O, no Prisma (eslint's domainBoundaryPatterns enforce this).
 *
 * HEALTH-ADJACENT DATA (Ley 25.326, DP-24 unresolved): this file only SHAPES
 * data the infrastructure layer already read under `pacientes.gestionar`;
 * it never logs and nothing here may end up in a URL (see
 * `modules/pacientes/application/get-trayectoria-paciente.ts` and `ui/*`).
 *
 * Shape of the data flow:
 *   infrastructure/trayectoria-repository.ts  ->  `TrayectoriaCruda` (raw rows)
 *   application/get-trayectoria-paciente.ts   ->  `armarTrayectoria()` (this file)
 *   ui/trayectoria-*.tsx                      ->  renders `TrayectoriaPaciente`
 *
 * Optional blocks (presupuesto, preparación, libro, archivo) arrive as EMPTY
 * arrays when the session cannot see them (the repository does not even
 * query them); `AccesoTrayectoria` tells the UI which blocks to render, so
 * "no data" and "not allowed" are never confused.
 */
import { Decimal, dec } from "@/shared/decimal";
import { esEstadoTerminal } from "@/modules/recetas/domain/receta";
import type { EstadoReceta, FormaFarmaceutica, OrigenReceta } from "@/modules/recetas/domain/receta";
import { etiquetaEstadoVisual, resolverEstadoVisualAsiento } from "@/modules/libro/domain/estado-visual";
import type { EstadoLoteArchivoValue } from "@/modules/archivo/domain/lote-archivo";
import type { ModalidadEntrega } from "@/modules/entregas/domain/entrega";

// ============================================================================
// Constants and labels
// ============================================================================

/** Recetas per page of the Trayectoria (spec: page size 10). */
export const PAGE_SIZE_TRAYECTORIA = 10;

/** Upper bound of the `?page=` value accepted by the use case; callers clamp to it (the repository then clamps to the last real page). */
export const PAGE_MAX_TRAYECTORIA = 100_000;

export const PASOS_JORNADA = ["INGRESO", "PREPARACION", "LIBRO", "ENTREGA", "ARCHIVO"] as const;
export type PasoJornadaId = (typeof PASOS_JORNADA)[number];

export const PASO_JORNADA_LABELS: Readonly<Record<PasoJornadaId, string>> = {
  INGRESO: "Ingreso",
  PREPARACION: "Preparación",
  LIBRO: "Libro",
  ENTREGA: "Entrega",
  ARCHIVO: "Archivo",
};

/** Where one step of a receta's journey stands. `NO_APLICA`: it will never happen (ANULADA receta). */
export type EstadoPaso = "COMPLETO" | "EN_CURSO" | "PENDIENTE" | "SIN_EFECTO" | "NO_APLICA";

export const ESTADO_PASO_LABELS: Readonly<Record<EstadoPaso, string>> = {
  COMPLETO: "Completo",
  EN_CURSO: "En curso",
  PENDIENTE: "Pendiente",
  SIN_EFECTO: "Sin efecto",
  NO_APLICA: "No aplica",
};

export const MODALIDAD_ENTREGA_LABELS: Readonly<Record<ModalidadEntrega, string>> = {
  RETIRO_PRESENCIAL: "Retiro presencial",
  ENVIO: "Envío",
};

export type EstadoPreparacionTrayectoria = "INICIADA" | "CONFIRMADA" | "DESCARTADA";
export type EstadoVisualAsientoTrayectoria = "VIGENTE" | "ANULADO" | "SIN_EFECTO";

// ============================================================================
// Which optional blocks the session may see
// ============================================================================

/**
 * Derived from the session's permisos by the use case (`can()`), then used
 * twice: the repository only loads the blocks that are `true`, and the UI
 * only renders (and links to) what is `true`. Each link flag is the permiso
 * of the target detail page's own layout guard.
 */
export interface AccesoTrayectoria {
  /** `cotizaciones.ver` */
  presupuesto: boolean;
  /** `preparaciones.iniciar` (also gates the link to /preparaciones/[id]) */
  preparacion: boolean;
  /** `libro.ver` (also gates the link to /libro/[id]) */
  libro: boolean;
  /** `archivo.lotes.gestionar` (also gates the link to /archivo/[id]) */
  archivo: boolean;
  /** `recetas.crear` -> /recetas/[id] */
  linkReceta: boolean;
  /** `entregas.registrar` -> /entregas/[recetaId] */
  linkEntrega: boolean;
}

// ============================================================================
// Raw input (what the repository reads)
// ============================================================================

export interface PacienteTrayectoria {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
  nroCredencial: string | null;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

/** One `estado` group of ALL the paciente's recetas -- the repository's single aggregate query. */
export interface GrupoRecetasCrudo {
  estado: EstadoReceta;
  cantidad: number;
  ultimaIngreso: Date | null;
}

export interface RecetaCruda {
  id: string;
  numeroInterno: string;
  fechaIngreso: Date;
  fechaPrescripcion: Date;
  medicoNombre: string;
  medicoApellido: string;
  origen: OrigenReceta;
  estado: EstadoReceta;
  motivoAnulacion: string | null;
  loteArchivoId: string | null;
}

export interface ItemCrudo {
  id: string;
  recetaId: string;
  descripcion: string | null;
  formaFarmaceutica: FormaFarmaceutica;
  cantidadUnidades: number;
  /** Droga names, in componente order. */
  drogas: string[];
}

export interface CotizacionCruda {
  itemRecetaId: string;
  /** Decimal string. */
  precioFinal: string;
  esParcial: boolean;
  esIncompleta: boolean;
  calculadaEn: Date;
}

export interface PreparacionCruda {
  id: string;
  itemRecetaId: string;
  estado: EstadoPreparacionTrayectoria;
  iniciadaEn: Date;
  confirmadaEn: Date | null;
  descartadaEn: Date | null;
  motivoDescarte: string | null;
}

/** The SISTEMA asiento of an item's CONFIRMADA preparación, with the facts `resolverEstadoVisualAsiento` needs. */
export interface AsientoCrudo {
  id: string;
  itemRecetaId: string;
  numeroCorrelativo: string;
  fechaAsiento: Date;
  estado: "VIGENTE" | "ANULADO";
  anulacion: { motivo: string; anuladoEn: Date } | null;
  rectificativoNumeroCorrelativo: string | null;
}

export interface EntregaCruda {
  recetaId: string;
  modalidad: ModalidadEntrega;
  entregadaEn: Date;
  firmaRecibida: boolean;
  firmaRecibidaEn: Date | null;
}

export interface LoteCrudo {
  id: string;
  numero: string;
  estado: EstadoLoteArchivoValue;
}

export interface TrayectoriaCruda {
  paciente: PacienteTrayectoria;
  grupos: GrupoRecetasCrudo[];
  /** The requested page of recetas (newest first). */
  recetas: RecetaCruda[];
  /** Page actually served (the requested one, clamped to the last). */
  page: number;
  zonaHoraria: string;
  items: ItemCrudo[];
  cotizaciones: CotizacionCruda[];
  preparaciones: PreparacionCruda[];
  asientos: AsientoCrudo[];
  entregas: EntregaCruda[];
  lotes: LoteCrudo[];
}

// ============================================================================
// Output (what the UI renders)
// ============================================================================

export interface ResumenTrayectoria {
  total: number;
  /** Not ENTREGADA / ANULADA. */
  enCurso: number;
  entregadas: number;
  anuladas: number;
  /** Latest `fechaIngreso` over ALL recetas, `null` without recetas. */
  ultimaAtencion: Date | null;
}

export interface PaginacionTrayectoria {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PresupuestoTrayectoria {
  /** Decimal string: sum of the latest cotización of every cotizado item. */
  total: string;
  itemsCotizados: number;
  itemsSinCotizar: number;
  /** Some cotizado item is partial (an excipiente is completed at preparation time). */
  esParcial: boolean;
  /** Some cotizado item was priced with less stock than needed. */
  esIncompleta: boolean;
}

export interface ItemCotizacionTrayectoria {
  precioFinal: string;
  esParcial: boolean;
  esIncompleta: boolean;
}

export interface PreparacionItemTrayectoria {
  id: string;
  estado: EstadoPreparacionTrayectoria;
  iniciadaEn: Date;
  confirmadaEn: Date | null;
  descartadaEn: Date | null;
  motivoDescarte: string | null;
}

export interface AsientoItemTrayectoria {
  id: string;
  numeroCorrelativo: string;
  fechaAsiento: Date;
  estadoVisual: EstadoVisualAsientoTrayectoria;
  /** Same wording as the libro pages ("Vigente", "Anulado", "Sin efecto por asiento Nº X"). */
  etiquetaEstado: string;
}

export interface ItemTrayectoria {
  id: string;
  descripcion: string | null;
  formaFarmaceutica: FormaFarmaceutica;
  cantidadUnidades: number;
  drogas: string[];
  /** Vigente cotización (INV-R06); `null` when never cotizado or the block is not visible. */
  cotizacion: ItemCotizacionTrayectoria | null;
  /** Oldest first; empty when none or the block is not visible. */
  preparaciones: PreparacionItemTrayectoria[];
  /** `null` when there is none or the block is not visible. */
  asiento: AsientoItemTrayectoria | null;
}

export interface EntregaTrayectoria {
  modalidad: ModalidadEntrega;
  entregadaEn: Date;
  firmaRecibida: boolean;
  firmaRecibidaEn: Date | null;
}

export interface LoteTrayectoria {
  id: string;
  numero: string;
  estado: EstadoLoteArchivoValue;
}

export interface PasoTrayectoria {
  paso: PasoJornadaId;
  estado: EstadoPaso;
}

export interface RecetaTrayectoria {
  id: string;
  numeroInterno: string;
  fechaIngreso: Date;
  fechaPrescripcion: Date;
  medico: string;
  origen: OrigenReceta;
  estado: EstadoReceta;
  motivoAnulacion: string | null;
  items: ItemTrayectoria[];
  /** `null` when the block is not visible or no item has a cotización. */
  presupuesto: PresupuestoTrayectoria | null;
  entrega: EntregaTrayectoria | null;
  lote: LoteTrayectoria | null;
  /** Only the steps the session may see, in journey order. */
  pasos: PasoTrayectoria[];
}

export interface TrayectoriaPaciente {
  paciente: PacienteTrayectoria;
  acceso: AccesoTrayectoria;
  resumen: ResumenTrayectoria;
  recetas: RecetaTrayectoria[];
  paginacion: PaginacionTrayectoria;
  /** The tenant's zona horaria, to show timestamptz values as the farmacia's calendar day. */
  zonaHoraria: string;
}

// ============================================================================
// Resumen / pagination
// ============================================================================

/** Counters over ALL the paciente's recetas (not just the page), from the repository's grouped aggregate. */
export function calcularResumen(grupos: readonly GrupoRecetasCrudo[]): ResumenTrayectoria {
  let total = 0;
  let enCurso = 0;
  let entregadas = 0;
  let anuladas = 0;
  let ultimaAtencion: Date | null = null;

  for (const g of grupos) {
    total += g.cantidad;
    if (g.estado === "ENTREGADA") entregadas += g.cantidad;
    if (g.estado === "ANULADA") anuladas += g.cantidad;
    if (!esEstadoTerminal(g.estado)) enCurso += g.cantidad;
    if (g.ultimaIngreso && (ultimaAtencion === null || g.ultimaIngreso > ultimaAtencion)) ultimaAtencion = g.ultimaIngreso;
  }

  return {
    total,
    enCurso,
    entregadas,
    anuladas,
    ultimaAtencion,
  };
}

/** Clamps `page` into `[1, totalPages]` (an empty result still has one page). */
export function calcularPaginacion(total: number, page: number, pageSize: number = PAGE_SIZE_TRAYECTORIA): PaginacionTrayectoria {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Math.max(1, page), totalPages), pageSize, total, totalPages };
}

// ============================================================================
// Presupuesto
// ============================================================================

/** INV-R06: the vigente cotización of an item is the one with the highest `calculadaEn`. */
export function cotizacionVigentePorItem(cotizaciones: readonly CotizacionCruda[]): Map<string, CotizacionCruda> {
  const vigente = new Map<string, CotizacionCruda>();
  for (const c of cotizaciones) {
    const actual = vigente.get(c.itemRecetaId);
    if (!actual || c.calculadaEn > actual.calculadaEn) vigente.set(c.itemRecetaId, c);
  }
  return vigente;
}

/**
 * Sum of the vigente cotización of each item of ONE receta. `null` when no
 * item was ever cotizado (nothing to add up). Items without cotización are
 * counted in `itemsSinCotizar` so the UI can say the total is incomplete.
 */
export function calcularPresupuesto(itemIds: readonly string[], cotizaciones: readonly CotizacionCruda[]): PresupuestoTrayectoria | null {
  const vigentes = cotizacionVigentePorItem(cotizaciones);
  let total = new Decimal(0);
  let cotizados = 0;
  let esParcial = false;
  let esIncompleta = false;
  for (const itemId of itemIds) {
    const c = vigentes.get(itemId);
    if (!c) continue;
    cotizados += 1;
    total = total.plus(dec(c.precioFinal));
    esParcial ||= c.esParcial;
    esIncompleta ||= c.esIncompleta;
  }
  if (cotizados === 0) return null;
  return { total: total.toString(), itemsCotizados: cotizados, itemsSinCotizar: itemIds.length - cotizados, esParcial, esIncompleta };
}

// ============================================================================
// Journey steps
// ============================================================================

/** An ANULADA receta never advances: a step that has not been reached will never be. */
function aplicarAnulada(estadoReceta: EstadoReceta, estado: EstadoPaso): EstadoPaso {
  if (estadoReceta === "ANULADA" && (estado === "PENDIENTE" || estado === "EN_CURSO")) return "NO_APLICA";
  return estado;
}

/** Preparación: COMPLETO when every item has a CONFIRMADA preparación; EN_CURSO when some has a CONFIRMADA or INICIADA one. */
export function estadoPasoPreparacion(estadoReceta: EstadoReceta, items: readonly Pick<ItemTrayectoria, "preparaciones">[]): EstadoPaso {
  const confirmados = items.filter((i) => i.preparaciones.some((p) => p.estado === "CONFIRMADA")).length;
  const iniciados = items.filter((i) => i.preparaciones.some((p) => p.estado === "INICIADA")).length;
  let estado: EstadoPaso = "PENDIENTE";
  if (items.length > 0 && confirmados === items.length) estado = "COMPLETO";
  else if (confirmados + iniciados > 0) estado = "EN_CURSO";
  return aplicarAnulada(estadoReceta, estado);
}

/**
 * Libro: COMPLETO when every item's asiento is VIGENTE; SIN_EFECTO when every
 * item has an asiento and none is in effect (anulados / rectificados);
 * EN_CURSO for anything in between (including an item that has no asiento
 * yet); PENDIENTE without asientos.
 */
export function estadoPasoLibro(estadoReceta: EstadoReceta, items: readonly Pick<ItemTrayectoria, "asiento">[]): EstadoPaso {
  const conAsiento = items.filter((i) => i.asiento !== null);
  const vigentes = conAsiento.filter((i) => i.asiento!.estadoVisual === "VIGENTE").length;
  let estado: EstadoPaso = "PENDIENTE";
  if (conAsiento.length > 0) {
    if (items.length > 0 && vigentes === items.length) estado = "COMPLETO";
    // SIN_EFECTO only once EVERY item has its asiento and none is in effect; an item still without asiento keeps the step open.
    else if (vigentes === 0 && conAsiento.length === items.length) estado = "SIN_EFECTO";
    else estado = "EN_CURSO";
  }
  return aplicarAnulada(estadoReceta, estado);
}

/** Entrega: COMPLETO once delivered (an ENVIO still waiting for the firma is EN_CURSO). */
export function estadoPasoEntrega(estadoReceta: EstadoReceta, entrega: Pick<EntregaTrayectoria, "modalidad" | "firmaRecibida"> | null): EstadoPaso {
  if (entrega) return entrega.modalidad === "ENVIO" && !entrega.firmaRecibida ? "EN_CURSO" : "COMPLETO";
  return aplicarAnulada(estadoReceta, "PENDIENTE");
}

/** Archivo: COMPLETO once the receta belongs to a lote, PENDIENTE otherwise (ENTREGADA and ANULADA recetas are both archivable). */
export function estadoPasoArchivo(lote: LoteTrayectoria | null): EstadoPaso {
  return lote ? "COMPLETO" : "PENDIENTE";
}

// ============================================================================
// Assembly
// ============================================================================

function agrupar<T, K>(filas: readonly T[], clave: (fila: T) => K): Map<K, T[]> {
  const mapa = new Map<K, T[]>();
  for (const fila of filas) {
    const k = clave(fila);
    const lista = mapa.get(k);
    if (lista) lista.push(fila);
    else mapa.set(k, [fila]);
  }
  return mapa;
}

function asientoItem(asiento: AsientoCrudo): AsientoItemTrayectoria {
  // Reuses the libro's own resolution rule so this view never disagrees with /libro. The
  // anulación's user names are deliberately not loaded (not shown here: data minimization).
  const visual = resolverEstadoVisualAsiento({
    estado: asiento.estado,
    anulacion: asiento.anulacion ? { motivo: asiento.anulacion.motivo, anuladoEn: asiento.anulacion.anuladoEn, anuladoPorNombre: "", autorizadoPorNombre: "" } : null,
    rectificativoNumeroCorrelativo: asiento.rectificativoNumeroCorrelativo,
  });
  return {
    id: asiento.id,
    numeroCorrelativo: asiento.numeroCorrelativo,
    fechaAsiento: asiento.fechaAsiento,
    estadoVisual: visual.kind,
    etiquetaEstado: etiquetaEstadoVisual(visual),
  };
}

/** Builds the page's recetas, each with its items, journey steps, presupuesto, entrega and lote. */
export function armarRecetasTrayectoria(cruda: TrayectoriaCruda, acceso: AccesoTrayectoria): RecetaTrayectoria[] {
  const itemsPorReceta = agrupar(cruda.items, (i) => i.recetaId);
  const cotizacionesPorItem = cotizacionVigentePorItem(cruda.cotizaciones);
  const preparacionesPorItem = agrupar(cruda.preparaciones, (p) => p.itemRecetaId);
  const asientoPorItem = new Map<string, AsientoCrudo>();
  for (const a of cruda.asientos) if (!asientoPorItem.has(a.itemRecetaId)) asientoPorItem.set(a.itemRecetaId, a);
  const entregaPorReceta = new Map(cruda.entregas.map((e) => [e.recetaId, e]));
  const lotePorId = new Map(cruda.lotes.map((l) => [l.id, l]));

  return cruda.recetas.map((receta) => {
    const items: ItemTrayectoria[] = (itemsPorReceta.get(receta.id) ?? []).map((item) => {
      const cotizacion = cotizacionesPorItem.get(item.id);
      const asiento = asientoPorItem.get(item.id);
      return {
        id: item.id,
        descripcion: item.descripcion,
        formaFarmaceutica: item.formaFarmaceutica,
        cantidadUnidades: item.cantidadUnidades,
        drogas: item.drogas,
        cotizacion: cotizacion ? { precioFinal: cotizacion.precioFinal, esParcial: cotizacion.esParcial, esIncompleta: cotizacion.esIncompleta } : null,
        preparaciones: [...(preparacionesPorItem.get(item.id) ?? [])]
          .sort((a, b) => a.iniciadaEn.getTime() - b.iniciadaEn.getTime())
          .map((p) => ({
            id: p.id,
            estado: p.estado,
            iniciadaEn: p.iniciadaEn,
            confirmadaEn: p.confirmadaEn,
            descartadaEn: p.descartadaEn,
            motivoDescarte: p.motivoDescarte,
          })),
        asiento: asiento ? asientoItem(asiento) : null,
      };
    });

    const entregaCruda = entregaPorReceta.get(receta.id);
    const entrega: EntregaTrayectoria | null = entregaCruda
      ? { modalidad: entregaCruda.modalidad, entregadaEn: entregaCruda.entregadaEn, firmaRecibida: entregaCruda.firmaRecibida, firmaRecibidaEn: entregaCruda.firmaRecibidaEn }
      : null;
    const loteCrudo = receta.loteArchivoId ? lotePorId.get(receta.loteArchivoId) : undefined;
    const lote: LoteTrayectoria | null = loteCrudo ? { id: loteCrudo.id, numero: loteCrudo.numero, estado: loteCrudo.estado } : null;

    const pasos: PasoTrayectoria[] = [{ paso: "INGRESO", estado: "COMPLETO" }];
    if (acceso.preparacion) pasos.push({ paso: "PREPARACION", estado: estadoPasoPreparacion(receta.estado, items) });
    if (acceso.libro) pasos.push({ paso: "LIBRO", estado: estadoPasoLibro(receta.estado, items) });
    pasos.push({ paso: "ENTREGA", estado: estadoPasoEntrega(receta.estado, entrega) });
    if (acceso.archivo) pasos.push({ paso: "ARCHIVO", estado: estadoPasoArchivo(lote) });

    return {
      id: receta.id,
      numeroInterno: receta.numeroInterno,
      fechaIngreso: receta.fechaIngreso,
      fechaPrescripcion: receta.fechaPrescripcion,
      medico: `${receta.medicoApellido}, ${receta.medicoNombre}`,
      origen: receta.origen,
      estado: receta.estado,
      motivoAnulacion: receta.motivoAnulacion,
      items,
      presupuesto: acceso.presupuesto ? calcularPresupuesto(items.map((i) => i.id), cruda.cotizaciones) : null,
      entrega,
      lote,
      pasos,
    };
  });
}

/** The whole view model of the Trayectoria page. */
export function armarTrayectoria(cruda: TrayectoriaCruda, acceso: AccesoTrayectoria): TrayectoriaPaciente {
  const resumen = calcularResumen(cruda.grupos);
  return {
    paciente: cruda.paciente,
    acceso,
    resumen,
    recetas: armarRecetasTrayectoria(cruda, acceso),
    paginacion: calcularPaginacion(resumen.total, cruda.page),
    zonaHoraria: cruda.zonaHoraria,
  };
}

/**
 * The step a receta is currently at, for the collapsed summary of its card:
 * the first step that is neither COMPLETO nor NO_APLICA (SIN_EFECTO counts --
 * it needs attention). `null` when every visible step is done, i.e. the
 * journey is complete. Only the steps the session may see are considered.
 */
export function etapaActual(pasos: readonly PasoTrayectoria[]): PasoTrayectoria | null {
  return pasos.find((p) => p.estado !== "COMPLETO" && p.estado !== "NO_APLICA") ?? null;
}

/** First item of a receta plus how many more there are, for the collapsed summary. `null` when it has no items. */
export function resumenItems(items: readonly ItemTrayectoria[]): { primero: ItemTrayectoria; restantes: number } | null {
  const [primero] = items;
  return primero ? { primero, restantes: items.length - 1 } : null;
}
