/**
 * Pure derivation for the proveedor "Trayectoria" view
 * (docs/specs/trayectoria-proveedor.md): every partida (= ingreso, INV-STK-002)
 * a proveedor supplied, with its movements and the optional blocks the session
 * may see. No I/O, no Prisma (eslint's domainBoundaryPatterns enforce this).
 *
 * Shape of the data flow (same as the paciente Trayectoria):
 *   infrastructure/trayectoria-repository.ts   ->  `TrayectoriaProveedorCruda` (raw rows)
 *   application/get-trayectoria-proveedor.ts   ->  `armarTrayectoriaProveedor()` (this file)
 *   ui/trayectoria-*.tsx                       ->  renders `TrayectoriaProveedor`
 *
 * Optional blocks (costos, preparaciones, contralor, correcciones de costo)
 * arrive as EMPTY / null when the session cannot see them (the repository does
 * not even query them); `AccesoTrayectoriaProveedor` tells the UI which blocks
 * to render, so "no data" and "not allowed" are never confused.
 *
 * No free-text field (observación, motivo) is ever logged from here.
 */
import { Decimal, dec } from "@/shared/decimal";
import { DIAS_ALERTA_VENCIMIENTO_PARTIDA_DEFAULT } from "@/modules/stock/domain/partida";

// ============================================================================
// Constants
// ============================================================================

/** Partidas per page of the Trayectoria (spec: 10). */
export const PAGE_SIZE_TRAYECTORIA_PROVEEDOR = 10;

/** Upper bound of the `?page=` value accepted by the use case; callers clamp to it (the repository then clamps to the last real page). */
export const PAGE_MAX_TRAYECTORIA_PROVEEDOR = 100_000;

/** Latest movements shown per partida (the rest lives in the partida's own kardex). */
export const MOVIMIENTOS_POR_PARTIDA_MAX = 20;

/** Latest preparaciones shown per partida. */
export const PREPARACIONES_POR_PARTIDA_MAX = 20;

// ============================================================================
// Derived estado of a partida
// ============================================================================

/**
 * Priority order, highest first: AGOTADA > VENCIDA > POR_VENCER > ABIERTA >
 * VIGENTE. It is DERIVED, never stored (the stock module has no estado column).
 */
export const ESTADOS_PARTIDA = ["AGOTADA", "VENCIDA", "POR_VENCER", "ABIERTA", "VIGENTE"] as const;
export type EstadoPartida = (typeof ESTADOS_PARTIDA)[number];

export const ESTADO_PARTIDA_LABELS: Readonly<Record<EstadoPartida, string>> = {
  AGOTADA: "Agotada",
  VENCIDA: "Vencida",
  POR_VENCER: "Por vencer",
  ABIERTA: "Abierta",
  VIGENTE: "Vigente",
};

/**
 * The window `dias_alerta_vencimiento_partida` (DP-14), parsed exactly like
 * `getDiasAlertaVencimiento` in modules/stock/infrastructure/partida-repository.ts
 * (the source of the /stock alerts): missing row -> the stock module's default
 * ("30"); anything that is not a positive integer -> 30. Mirrored here, not
 * imported, because a module may not reach into another module's
 * infrastructure layer.
 */
export function parseDiasAlertaVencimiento(raw: string | null | undefined): number {
  const parsed = Number.parseInt(raw ?? DIAS_ALERTA_VENCIMIENTO_PARTIDA_DEFAULT, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/** `jornada` (YYYY-MM-DD) plus `dias` calendar days, as YYYY-MM-DD. Calendar arithmetic in UTC: no DST drift. */
export function sumarDiasAJornada(jornada: string, dias: number): string {
  const [anio, mes, dia] = jornada.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

/** A Postgres `date` arrives as UTC midnight: its calendar day is the UTC one (never the server's zone). */
export function fechaCalendario(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export interface PartidaParaEstado {
  /** Decimal string, droga unidad base. */
  cantidadDisponible: string;
  /** Postgres `date` (UTC midnight). */
  fechaVencimiento: Date;
  fechaApertura: Date | null;
}

export interface ContextoEstadoPartida {
  /** The tenant's jornada actual (`fsj.jornada_actual`), YYYY-MM-DD. NEVER `new Date()`. */
  jornada: string;
  /** `dias_alerta_vencimiento_partida`, see `parseDiasAlertaVencimiento`. */
  diasAlerta: number;
}

/**
 * The estado of a partida, with the SAME rules as the stock alerts
 * (`alertasVencidasConSaldo` / `alertasPorVencer` in
 * modules/stock/infrastructure/partida-repository.ts), so /stock and this
 * view never disagree:
 *   - AGOTADA: no balance (`cantidad_disponible > 0` is false). Both alerts
 *     require balance, so an agotada partida is never "vencida con saldo" nor
 *     "por vencer" there either.
 *   - VENCIDA: `fecha_vencimiento < jornada`.
 *   - POR_VENCER: `jornada <= fecha_vencimiento <= jornada + dias` (both ends
 *     inclusive).
 *   - ABIERTA: `fecha_apertura` is set.
 *   - VIGENTE: anything else.
 * Dates are compared as YYYY-MM-DD strings (lexicographic order = calendar order).
 */
export function derivarEstadoPartida(partida: PartidaParaEstado, contexto: ContextoEstadoPartida): EstadoPartida {
  if (!dec(partida.cantidadDisponible).greaterThan(0)) return "AGOTADA";
  const vencimiento = fechaCalendario(partida.fechaVencimiento);
  if (vencimiento < contexto.jornada) return "VENCIDA";
  if (vencimiento <= sumarDiasAJornada(contexto.jornada, contexto.diasAlerta)) return "POR_VENCER";
  if (partida.fechaApertura !== null) return "ABIERTA";
  return "VIGENTE";
}

// ============================================================================
// Which optional blocks the session may see
// ============================================================================

/**
 * Derived from the session's permisos by the use case (`can()`), then used
 * twice: the repository only loads the blocks that are `true`, and the UI
 * only renders (and links to) what is `true`. `linkPartida` only gates a link
 * (the page `/stock/partidas/[id]` guards on `stock.ver`), no data.
 */
export interface AccesoTrayectoriaProveedor {
  /** `stock.valorizado.ver`: costo unitario, total comprado, stock valorizado. */
  costos: boolean;
  /** `preparaciones.iniciar` (also gates the link to /preparaciones/[id]). */
  preparaciones: boolean;
  /** `libro.ver`. */
  contralor: boolean;
  /** `auditoria.ver`. */
  correcciones: boolean;
  /** `stock.ver` -> /stock/partidas/[id]. */
  linkPartida: boolean;
}

// ============================================================================
// Raw input (what the repository reads)
// ============================================================================

export interface ProveedorTrayectoria {
  id: string;
  razonSocial: string;
  /** 11 raw digits as stored; the UI formats it with `formatCuit`. */
  cuit: string;
  fechaBaja: Date | null;
  motivoBaja: string | null;
}

/** Counters over ALL the proveedor's partidas -- the repository's single aggregate (SQL, never summed in JS). */
export interface ResumenCrudo {
  partidas: number;
  drogasDistintas: number;
  ultimoIngreso: Date | null;
  vencidasConSaldo: number;
  porVencer: number;
}

/** Money over ALL the proveedor's partidas, `numeric` computed in SQL, as decimal strings. Only read with `stock.valorizado.ver`. */
export interface TotalesCostoCrudos {
  totalComprado: string;
  stockValorizado: string;
}

export interface PartidaCruda {
  id: string;
  drogaNombre: string;
  /** `tipo_control <> 'NINGUNO'`. */
  esControlada: boolean;
  unidadBaseId: string;
  unidadBaseSimbolo: string;
  lote: string;
  fechaIngreso: Date;
  fechaVencimiento: Date;
  fechaApertura: Date | null;
  cantidadInicial: string;
  cantidadDisponible: string;
  /** `null` when the session lacks `stock.valorizado.ver` (the column is not even selected). */
  costoUnitario: string | null;
}

export type TipoMovimientoValor = "INGRESO_COMPRA" | "EGRESO_PREPARACION" | "AJUSTE";

export interface MovimientoCrudo {
  id: string;
  partidaId: string;
  tipo: TipoMovimientoValor;
  cantidad: string;
  motivoAjuste: string | null;
  observacion: string | null;
  registradoEn: Date;
  registradoPorId: string;
  autorizadoPorId: string | null;
  /** Movements of the partida in total (not just the capped slice). */
  totalDePartida: number;
}

export interface UsuarioNombre {
  id: string;
  nombre: string;
  apellido: string;
}

export interface PreparacionCruda {
  partidaId: string;
  id: string;
  estado: "INICIADA" | "CONFIRMADA" | "DESCARTADA";
  iniciadaEn: Date;
  confirmadaEn: Date | null;
  descartadaEn: Date | null;
  totalDePartida: number;
}

export interface ContralorCrudo {
  partidaId: string;
  numeroValeAdquisicion: string | null;
  /** `null` when the ingreso has no asiento contralor (the tenant's contralor was not active yet). */
  numeroAsiento: string | null;
}

export interface AuditoriaCostoCruda {
  id: string;
  partidaId: string;
  valorAnterior: unknown;
  valorNuevo: unknown;
  motivo: string | null;
  ocurridoEn: Date;
  usuarioNombre: string;
  usuarioApellido: string;
}

export interface TrayectoriaProveedorCruda {
  proveedor: ProveedorTrayectoria;
  zonaHoraria: string;
  /** The tenant's jornada actual, read ONCE and used for both the SQL counters and the per-partida estado. */
  jornada: string;
  diasAlerta: number;
  resumen: ResumenCrudo;
  /** `null` unless `acceso.costos`. */
  totales: TotalesCostoCrudos | null;
  /** Requested page, already clamped to the last real page. */
  page: number;
  partidas: PartidaCruda[];
  movimientos: MovimientoCrudo[];
  usuarios: UsuarioNombre[];
  preparaciones: PreparacionCruda[];
  contralor: ContralorCrudo[];
  auditoria: AuditoriaCostoCruda[];
}

// ============================================================================
// View model (what the UI renders)
// ============================================================================

export interface ResumenTrayectoriaProveedor {
  partidas: number;
  drogasDistintas: number;
  ultimoIngreso: Date | null;
  vencidasConSaldo: number;
  porVencer: number;
  /** `null` without `stock.valorizado.ver`. Both at the CURRENT cost of each partida (no cost history exists). */
  totales: TotalesCostoCrudos | null;
}

export interface MovimientoTrayectoria {
  id: string;
  tipo: TipoMovimientoValor;
  cantidad: string;
  motivoAjuste: string | null;
  observacion: string | null;
  registradoEn: Date;
  registradoPor: string;
  autorizadoPor: string | null;
}

export interface PreparacionTrayectoria {
  id: string;
  estado: "INICIADA" | "CONFIRMADA" | "DESCARTADA";
  iniciadaEn: Date;
  confirmadaEn: Date | null;
  descartadaEn: Date | null;
}

export interface ContralorTrayectoria {
  numeroValeAdquisicion: string | null;
  numeroAsiento: string | null;
}

export interface CorreccionCostoTrayectoria {
  id: string;
  /** Decimal strings; `null` when that side of the diff has no `costoUnitario`. */
  costoAnterior: string | null;
  costoNuevo: string | null;
  motivo: string | null;
  quien: string;
  cuando: Date;
}

/** A capped list plus how many exist in total, so the UI can say "mostrando 20 de N". */
export interface ListaAcotada<T> {
  items: T[];
  total: number;
  hayMas: boolean;
}

export interface PartidaTrayectoria {
  id: string;
  drogaNombre: string;
  unidadBaseId: string;
  unidadBaseSimbolo: string;
  lote: string;
  fechaIngreso: Date;
  fechaVencimiento: Date;
  fechaApertura: Date | null;
  cantidadInicial: string;
  cantidadDisponible: string;
  estado: EstadoPartida;
  /** `null` without `stock.valorizado.ver`. */
  costoUnitario: string | null;
  movimientos: ListaAcotada<MovimientoTrayectoria>;
  /** `null` without `preparaciones.iniciar`. */
  preparaciones: ListaAcotada<PreparacionTrayectoria> | null;
  /** `null` without `libro.ver`, or when the droga is not controlled. */
  contralor: ContralorTrayectoria | null;
  /** `null` without `auditoria.ver`. */
  correcciones: CorreccionCostoTrayectoria[] | null;
}

export interface PaginacionTrayectoriaProveedor {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TrayectoriaProveedor {
  proveedor: ProveedorTrayectoria;
  acceso: AccesoTrayectoriaProveedor;
  zonaHoraria: string;
  resumen: ResumenTrayectoriaProveedor;
  partidas: PartidaTrayectoria[];
  paginacion: PaginacionTrayectoriaProveedor;
}

// ============================================================================
// Pagination
// ============================================================================

/** Clamps `page` into `[1, totalPages]` (an empty result still has one page). */
export function calcularPaginacion(total: number, page: number, pageSize: number = PAGE_SIZE_TRAYECTORIA_PROVEEDOR): PaginacionTrayectoriaProveedor {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Math.max(1, page), totalPages), pageSize, total, totalPages };
}

// ============================================================================
// Correcciones de costo (audit rows)
// ============================================================================

function costoDelDiff(valor: unknown): string | null {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return null;
  const costo = (valor as Record<string, unknown>)["costoUnitario"];
  if (typeof costo !== "string" && typeof costo !== "number") return null;
  try {
    return new Decimal(costo).toFixed();
  } catch {
    return null;
  }
}

/** Does the diff carry a `costoUnitario` key at all (even a malformed one)? */
function tocaCosto(valor: unknown): boolean {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) && Object.hasOwn(valor, "costoUnitario");
}

/**
 * `{ costoAnterior, costoNuevo }` of an audit row of a partida, or `null` when
 * the diff does NOT touch `costoUnitario` (any other MODIFICAR on a partida is
 * not a "corrección de costo" and must not show up as one). A side whose value
 * is missing or not a number comes back as `null`.
 */
export function correccionDeCosto(valorAnterior: unknown, valorNuevo: unknown): { costoAnterior: string | null; costoNuevo: string | null } | null {
  if (!tocaCosto(valorAnterior) && !tocaCosto(valorNuevo)) return null;
  return { costoAnterior: costoDelDiff(valorAnterior), costoNuevo: costoDelDiff(valorNuevo) };
}

// ============================================================================
// Assembly
// ============================================================================

function nombreCompleto(usuario: UsuarioNombre | undefined): string {
  return usuario ? `${usuario.nombre} ${usuario.apellido}` : "—";
}

function agrupar<T extends { partidaId: string }>(filas: readonly T[]): Map<string, T[]> {
  const porPartida = new Map<string, T[]>();
  for (const fila of filas) {
    const lista = porPartida.get(fila.partidaId);
    if (lista) lista.push(fila);
    else porPartida.set(fila.partidaId, [fila]);
  }
  return porPartida;
}

function acotar<T>(items: T[], total: number): ListaAcotada<T> {
  return { items, total, hayMas: total > items.length };
}

/**
 * Shapes the raw rows into the view model. Each optional block is built ONLY
 * when `acceso` allows it, even if the caller handed in rows for it (defense in
 * depth: the repository already skips the query).
 */
export function armarTrayectoriaProveedor(cruda: TrayectoriaProveedorCruda, acceso: AccesoTrayectoriaProveedor): TrayectoriaProveedor {
  const usuarios = new Map(cruda.usuarios.map((u) => [u.id, u]));
  const movimientos = agrupar(cruda.movimientos);
  const preparaciones = agrupar(cruda.preparaciones);
  const contralor = new Map(cruda.contralor.map((c) => [c.partidaId, c]));
  const correcciones = agrupar(cruda.auditoria);
  const contexto: ContextoEstadoPartida = { jornada: cruda.jornada, diasAlerta: cruda.diasAlerta };

  const partidas: PartidaTrayectoria[] = cruda.partidas.map((p) => {
    const movs = movimientos.get(p.id) ?? [];
    const preps = preparaciones.get(p.id) ?? [];
    const asiento = contralor.get(p.id);
    return {
      id: p.id,
      drogaNombre: p.drogaNombre,
      unidadBaseId: p.unidadBaseId,
      unidadBaseSimbolo: p.unidadBaseSimbolo,
      lote: p.lote,
      fechaIngreso: p.fechaIngreso,
      fechaVencimiento: p.fechaVencimiento,
      fechaApertura: p.fechaApertura,
      cantidadInicial: p.cantidadInicial,
      cantidadDisponible: p.cantidadDisponible,
      estado: derivarEstadoPartida(p, contexto),
      costoUnitario: acceso.costos ? p.costoUnitario : null,
      movimientos: acotar(
        movs.map((m) => ({
          id: m.id,
          tipo: m.tipo,
          cantidad: m.cantidad,
          motivoAjuste: m.motivoAjuste,
          observacion: m.observacion,
          registradoEn: m.registradoEn,
          registradoPor: nombreCompleto(usuarios.get(m.registradoPorId)),
          autorizadoPor: m.autorizadoPorId ? nombreCompleto(usuarios.get(m.autorizadoPorId)) : null,
        })),
        movs[0]?.totalDePartida ?? 0,
      ),
      preparaciones: acceso.preparaciones
        ? acotar(
            preps.map((r) => ({ id: r.id, estado: r.estado, iniciadaEn: r.iniciadaEn, confirmadaEn: r.confirmadaEn, descartadaEn: r.descartadaEn })),
            preps[0]?.totalDePartida ?? 0,
          )
        : null,
      contralor:
        acceso.contralor && p.esControlada ? { numeroValeAdquisicion: asiento?.numeroValeAdquisicion ?? null, numeroAsiento: asiento?.numeroAsiento ?? null } : null,
      correcciones: acceso.correcciones
        ? (correcciones.get(p.id) ?? []).flatMap((a) => {
            const diff = correccionDeCosto(a.valorAnterior, a.valorNuevo);
            return diff
              ? [
                  {
                    id: a.id,
                    costoAnterior: acceso.costos ? diff.costoAnterior : null,
                    costoNuevo: acceso.costos ? diff.costoNuevo : null,
                    motivo: a.motivo,
                    quien: `${a.usuarioNombre} ${a.usuarioApellido}`,
                    cuando: a.ocurridoEn,
                  },
                ]
              : [];
          })
        : null,
    };
  });

  return {
    proveedor: cruda.proveedor,
    acceso,
    zonaHoraria: cruda.zonaHoraria,
    resumen: {
      partidas: cruda.resumen.partidas,
      drogasDistintas: cruda.resumen.drogasDistintas,
      ultimoIngreso: cruda.resumen.ultimoIngreso,
      vencidasConSaldo: cruda.resumen.vencidasConSaldo,
      porVencer: cruda.resumen.porVencer,
      totales: acceso.costos ? cruda.totales : null,
    },
    partidas,
    paginacion: calcularPaginacion(cruda.resumen.partidas, cruda.page),
  };
}
