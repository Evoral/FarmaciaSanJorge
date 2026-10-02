/**
 * Pure derivation for the "Comparador de costos" (docs/specs/comparador-costos.md):
 * what each proveedor charged for ONE droga. No I/O, no Prisma (eslint's
 * domainBoundaryPatterns enforce this).
 *
 * Data flow (same shape as the Trayectoria views):
 *   infrastructure/comparador-costos-repository.ts -> `ComparacionCruda` (raw rows, SQL numeric as text)
 *   application/comparar-costos-droga.ts           -> `armarComparacion()` (this file)
 *   ui/comparador-*.tsx                            -> renders `ComparacionCostos`
 *
 * Why costs of one droga are directly comparable: `partida.costo_unitario` is
 * typed per UNIDAD BASE of the droga and that unit is immutable once the droga
 * has partidas (INV-DRG-001). The display unit ("Mostrar costo por") is a
 * pure presentation conversion: `costoBase x factorDestino / factorOrigen`.
 *
 * Money and quantities are `Decimal` end to end (INV-PL-003): never a float.
 * Costs and quantities enter and leave this file as decimal strings.
 */
import { Decimal, dec } from "@/shared/decimal";
import { CADENAS_CONVERTIBLES } from "@/shared/format/cantidad";
import type { UnidadFormato } from "@/shared/format/cantidad";
import { inicioDeJornada, jornadaDe } from "@/shared/time/jornada";
import { uuid } from "@/shared/validation";

// ============================================================================
// Constants
// ============================================================================

/** Rows of the expandable detail per proveedor (the rest is reported as "mostrando N de M"). */
export const PARTIDAS_DETALLE_MAX = 50;

/** A latest purchase older than this many months is flagged "Antiguo". */
export const MESES_COMPRA_ANTIGUA = 12;

/** Months covered by the `12m` periodo. */
export const MESES_PERIODO_12M = 12;

/** Outlier detection needs at least this many partidas with cost > 0 in the period; with fewer, nothing is flagged. */
export const MIN_PARTIDAS_PARA_ATIPICOS = 3;

/** A cost above `median x 10` or below `median x 0.1` is an outlier. */
export const FACTOR_ATIPICO_ALTO = "10";
export const FACTOR_ATIPICO_BAJO = "0.1";

/** Narrowest a ranking bar is drawn (percent), so a tiny positive cost never reads as "no bar". */
export const BARRA_MINIMA_PORCENTAJE = 2;

export const PERIODOS_COMPARADOR = ["12m", "todo"] as const;
export type PeriodoComparador = (typeof PERIODOS_COMPARADOR)[number];
export const PERIODO_PREDETERMINADO: PeriodoComparador = "12m";

export const PERIODO_LABELS: Readonly<Record<PeriodoComparador, string>> = {
  "12m": "Últimos 12 meses",
  todo: "Todo el historial",
};

/** Value of the "Mostrar costo por" option that stands for the droga's own unidad base. */
export const UNIDAD_BASE_VALOR = "base";

/**
 * Practical display unit per unidad base, by `codigo`: a pharmacist buys by
 * the gram / the mL, so a cost per mg or per mcg is shown per g by default
 * (and per mcL per mL). Any other base stays as it is.
 */
export const UNIDAD_PREDETERMINADA_POR_BASE: Readonly<Record<string, string>> = {
  MICROGRAMO: "GRAMO",
  MILIGRAMO: "GRAMO",
  MICROLITRO: "MILILITRO",
};

// ============================================================================
// Filter parameters
// ============================================================================

type ParamCrudo = string | string[] | undefined;

export interface ParametrosComparadorCrudos {
  droga?: ParamCrudo;
  unidad?: ParamCrudo;
  periodo?: ParamCrudo;
}

export interface FiltrosComparador {
  /** A valid uuid, or `null` (nothing selected / malformed). */
  drogaId: string | null;
  /** A `droga` param is present (non-empty) but is not a uuid: the page says the droga is not available instead of showing the bare instructions. */
  drogaInvalida: boolean;
  /** `"base"` or an uppercase unit `codigo`; `null` = use the default. Whether it fits the droga is decided later by `resolverUnidadCosto`. */
  unidad: string | null;
  periodo: PeriodoComparador;
}

function primerValor(valor: ParamCrudo): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

const CODIGO_UNIDAD = /^[A-Za-z_]{1,32}$/;

/**
 * The URL is untrusted: `droga` must be a uuid (else `null`), `unidad` a plain
 * code (`base` or letters/underscore only, up to 32), `periodo` one of the two
 * known values (anything else falls back to `12m`). A repeated param keeps its
 * first value. Never throws.
 */
export function parsearFiltrosComparador(raw: ParametrosComparadorCrudos): FiltrosComparador {
  const droga = primerValor(raw.droga)?.trim();
  const unidad = primerValor(raw.unidad)?.trim();
  const periodo = primerValor(raw.periodo)?.trim();

  const drogaValida = Boolean(droga) && uuid.safeParse(droga).success;
  let unidadNormalizada: string | null = null;
  if (unidad && CODIGO_UNIDAD.test(unidad)) {
    unidadNormalizada = unidad.toLowerCase() === UNIDAD_BASE_VALOR ? UNIDAD_BASE_VALOR : unidad.toUpperCase();
  }

  return {
    drogaId: drogaValida ? droga! : null,
    drogaInvalida: Boolean(droga) && !drogaValida,
    unidad: unidadNormalizada,
    periodo: (PERIODOS_COMPARADOR as readonly string[]).includes(periodo ?? "") ? (periodo as PeriodoComparador) : PERIODO_PREDETERMINADO,
  };
}

// ============================================================================
// Droga options
// ============================================================================

export interface DrogaOpcionCruda {
  id: string;
  nombre: string;
  fechaBaja: Date | null;
}

export interface DrogaOpcion {
  id: string;
  nombre: string;
  deBaja: boolean;
}

/** Vigentes first, then the ones "de baja"; each group by name (the repository already sorts by name, this keeps the groups stable). */
export function ordenarOpcionesDroga(drogas: readonly DrogaOpcionCruda[]): DrogaOpcion[] {
  const opciones = drogas.map((d) => ({ id: d.id, nombre: d.nombre, deBaja: d.fechaBaja !== null }));
  const porNombre = (a: DrogaOpcion, b: DrogaOpcion) => a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id);
  return [...opciones.filter((o) => !o.deBaja).sort(porNombre), ...opciones.filter((o) => o.deBaja).sort(porNombre)];
}

/** Text of a droga `<option>`. */
export function etiquetaOpcionDroga(opcion: DrogaOpcion): string {
  return opcion.deBaja ? `${opcion.nombre} (de baja)` : opcion.nombre;
}

// ============================================================================
// Display unit
// ============================================================================

export interface OpcionUnidadCosto {
  /** `"base"` for the droga's unidad base, the unit `codigo` otherwise: the value of the `unidad` URL param. */
  valor: string;
  unidad: UnidadFormato;
  /** "mg (unidad base)", "g", ... */
  etiqueta: string;
}

function factorPositivo(unidad: Pick<UnidadFormato, "codigo" | "factorABase">): Decimal {
  const factor = dec(unidad.factorABase);
  if (!factor.isFinite() || !factor.greaterThan(0)) throw new Error(`Unidad ${unidad.codigo}: factor_a_base must be positive.`);
  return factor;
}

/**
 * The units a cost of `base` can be shown in: only the whitelisted
 * convertible chains (`CADENAS_CONVERTIBLES`: masa and volumen) of the droga's
 * own magnitude, smallest first, vigentes only (the base itself is always
 * kept, even if dada de baja, so the default "base" always exists). A
 * non-convertible base (UNIDAD, ...) only offers itself.
 */
export function unidadesConvertiblesDe(base: UnidadFormato, catalogo: readonly UnidadFormato[]): UnidadFormato[] {
  const cadena = CADENAS_CONVERTIBLES[base.tipoMagnitud];
  if (!cadena?.includes(base.codigo)) return [base];
  const porId = new Map<string, UnidadFormato>([[base.id, base]]);
  for (const unidad of catalogo) {
    if (unidad.tipoMagnitud !== base.tipoMagnitud || !cadena.includes(unidad.codigo)) continue;
    if (unidad.vigente === false && unidad.id !== base.id) continue;
    // The catalog row of the base wins (same data), the first row of any other unit wins.
    if (!porId.has(unidad.id) || unidad.id === base.id) porId.set(unidad.id, unidad);
  }
  return [...porId.values()].sort((a, b) => factorPositivo(a).comparedTo(factorPositivo(b)) || a.codigo.localeCompare(b.codigo));
}

export function opcionesUnidadCosto(base: UnidadFormato, catalogo: readonly UnidadFormato[]): OpcionUnidadCosto[] {
  return unidadesConvertiblesDe(base, catalogo).map((unidad) =>
    unidad.id === base.id
      ? { valor: UNIDAD_BASE_VALOR, unidad, etiqueta: `${unidad.simbolo} (unidad base)` }
      : { valor: unidad.codigo, unidad, etiqueta: unidad.simbolo },
  );
}

/** The default display unit: the practical one for the base (mg/mcg -> g, mcL -> mL) when it is offered, else the base. */
export function unidadPredeterminada(base: UnidadFormato, opciones: readonly OpcionUnidadCosto[]): OpcionUnidadCosto {
  const baseOpcion = opciones.find((o) => o.unidad.id === base.id) ?? { valor: UNIDAD_BASE_VALOR, unidad: base, etiqueta: `${base.simbolo} (unidad base)` };
  const codigo = UNIDAD_PREDETERMINADA_POR_BASE[base.codigo];
  return (codigo ? opciones.find((o) => o.unidad.codigo === codigo) : undefined) ?? baseOpcion;
}

/**
 * The display unit for a requested `unidad` param: `"base"` or a `codigo`
 * offered for this droga; anything else (absent, from another magnitude,
 * unknown) falls back to the default. Returns the whole option list too.
 */
export function resolverUnidadCosto(
  base: UnidadFormato,
  catalogo: readonly UnidadFormato[],
  pedida: string | null,
): { seleccionada: OpcionUnidadCosto; opciones: OpcionUnidadCosto[] } {
  const opciones = opcionesUnidadCosto(base, catalogo);
  const pedidaNormalizada = pedida?.trim().toUpperCase();
  const elegida = pedidaNormalizada ? opciones.find((o) => o.valor.toUpperCase() === pedidaNormalizada || o.unidad.codigo === pedidaNormalizada) : undefined;
  return { seleccionada: elegida ?? unidadPredeterminada(base, opciones), opciones };
}

/** A cost per `origen` unit expressed per `destino` unit: `costo x factorDestino / factorOrigen` (1 mg at $2 is 1 g at $2.000). */
export function convertirCosto(costo: string | Decimal, origen: Pick<UnidadFormato, "codigo" | "factorABase">, destino: Pick<UnidadFormato, "codigo" | "factorABase">): Decimal {
  const valor = typeof costo === "string" ? dec(costo) : costo;
  return valor.times(factorPositivo(destino)).div(factorPositivo(origen));
}

// ============================================================================
// Period and "antiguo"
// ============================================================================

/** `YYYY-MM-DD` minus `meses` calendar months, the day clamped to the target month's last day (2026-03-31 - 1 month = 2026-02-28). */
export function restarMeses(fecha: string, meses: number): string {
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  const totalMeses = anio * 12 + (mes - 1) - meses;
  const anioDestino = Math.floor(totalMeses / 12);
  const mesDestino = totalMeses - anioDestino * 12; // 0-based
  const ultimoDia = new Date(Date.UTC(anioDestino, mesDestino + 1, 0)).getUTCDate();
  const pad = (n: number, largo = 2) => String(n).padStart(largo, "0");
  return `${pad(anioDestino, 4)}-${pad(mesDestino + 1)}-${pad(Math.min(dia, ultimoDia))}`;
}

/**
 * The first instant of the periodo, or `null` for the whole history: local
 * midnight, in the tenant's zona horaria, of the jornada 12 months before the
 * tenant's current jornada. `jornada` is `fsj.jornada_actual(tenant)`, never
 * the server clock.
 */
export function inicioPeriodo(periodo: PeriodoComparador, jornada: string, zonaHoraria: string): Date | null {
  if (periodo === "todo") return null;
  return inicioDeJornada(restarMeses(jornada, MESES_PERIODO_12M), zonaHoraria);
}

/** True when the purchase's local calendar day (tenant zone) is before `jornada` minus 12 months. */
export function esCompraAntigua(ultimaCompra: Date, jornada: string, zonaHoraria: string): boolean {
  return jornadaDe(ultimaCompra, zonaHoraria) < restarMeses(jornada, MESES_COMPRA_ANTIGUA);
}

// ============================================================================
// Outliers
// ============================================================================

export interface LimitesAtipicos {
  /** Costs strictly below this (per unidad base) are outliers: `median x 0.1`. */
  minimo: string;
  /** Costs strictly above this (per unidad base) are outliers: `median x 10`. */
  maximo: string;
}

/**
 * The outlier band of the droga. `mediana` is the median of the cost
 * (per unidad base) of the droga's partidas with cost > 0 in the period,
 * computed in SQL with `percentile_disc(0.5)` (an exact numeric: for an even
 * count it is the LOWER middle value); `partidasConCosto` is how many partidas
 * it covers. No band (nothing is flagged) with fewer than 3 partidas or no
 * positive median.
 */
export function limitesAtipicos(mediana: string | null, partidasConCosto: number): LimitesAtipicos | null {
  if (mediana === null || partidasConCosto < MIN_PARTIDAS_PARA_ATIPICOS) return null;
  const centro = dec(mediana);
  if (!centro.isFinite() || !centro.greaterThan(0)) return null;
  return { minimo: centro.times(FACTOR_ATIPICO_BAJO).toFixed(), maximo: centro.times(FACTOR_ATIPICO_ALTO).toFixed() };
}

/** A cost > 0 outside the band. Cost 0 is never an outlier (it is excluded from every metric instead). */
export function esCostoAtipico(costo: string, limites: LimitesAtipicos | null): boolean {
  if (!limites) return false;
  const valor = dec(costo);
  if (!valor.greaterThan(0)) return false;
  return valor.greaterThan(dec(limites.maximo)) || valor.lessThan(dec(limites.minimo));
}

// ============================================================================
// Metrics
// ============================================================================

/** Weighted average cost: `sum(cantidad x costo) / sum(cantidad)` over the partidas with cost > 0. `null` when there is no quantity. */
export function promedioPonderado(importe: string, cantidad: string): Decimal | null {
  const total = dec(cantidad);
  if (!total.greaterThan(0)) return null;
  return dec(importe).div(total);
}

export interface DiferenciaCosto {
  /** `ultimo - minimo`, in the same unit as the inputs. */
  monto: string;
  /** `(ultimo - minimo) / minimo x 100`, 2 decimals. */
  porcentaje: string;
}

/** The difference of a costo against the cheapest one. `null` when the minimum is not positive (no meaningful percentage). */
export function diferenciaContraMinimo(ultimo: string | Decimal, minimo: string | Decimal): DiferenciaCosto | null {
  const u = typeof ultimo === "string" ? dec(ultimo) : ultimo;
  const m = typeof minimo === "string" ? dec(minimo) : minimo;
  if (!m.greaterThan(0)) return null;
  const diferencia = u.minus(m);
  return { monto: diferencia.toFixed(), porcentaje: diferencia.div(m).times(100).toDecimalPlaces(2).toFixed() };
}

/** Width (percent, 1 decimal, as text) of the ranking bar of `valor` against the largest `maximo`; between 2 and 100. */
export function porcentajeBarra(valor: string | Decimal, maximo: string | Decimal): string {
  const v = typeof valor === "string" ? dec(valor) : valor;
  const m = typeof maximo === "string" ? dec(maximo) : maximo;
  if (!m.greaterThan(0) || !v.greaterThan(0)) return "0";
  const porcentaje = v.div(m).times(100);
  const acotado = Decimal.min(Decimal.max(porcentaje, BARRA_MINIMA_PORCENTAJE), 100);
  return acotado.toDecimalPlaces(1).toFixed();
}

// ============================================================================
// Raw shapes (repository) and assembled shapes (UI)
// ============================================================================

/** One proveedor's aggregate over the droga's partidas in the period. Costs per unidad base, numeric as text. */
export interface AgregadoProveedorCrudo {
  proveedorId: string;
  razonSocial: string;
  fechaBaja: Date | null;
  /** All the partidas of the period, cost 0 included. */
  partidasTotal: number;
  /** Partidas with cost > 0 (the only ones every metric uses). */
  partidasConCosto: number;
  partidasCostoCero: number;
  /** Partidas with cost > 0 outside the droga's outlier band (as decided by the SQL against `limites`). */
  partidasAtipicas: number;
  /** `sum(cantidad_inicial)` over the partidas with cost > 0. */
  cantidadConCosto: string;
  /** `sum(cantidad_inicial x costo_unitario)` over the partidas with cost > 0. */
  importeConCosto: string;
  costoMin: string | null;
  costoMax: string | null;
  /** Cost of the latest partida (`fecha_ingreso DESC, id DESC`) with cost > 0. */
  ultimoCosto: string | null;
  ultimaCompra: Date | null;
}

export interface PartidaComparadorCruda {
  id: string;
  proveedorId: string;
  lote: string;
  fechaIngreso: Date;
  /** In the droga's unidad base. */
  cantidadInicial: string;
  /** Per unidad base. */
  costoUnitario: string;
}

export interface DrogaComparador {
  id: string;
  nombre: string;
  deBaja: boolean;
}

export interface ComparacionCruda {
  droga: DrogaComparador;
  unidadBase: UnidadFormato;
  /** Catalog rows of the droga's magnitude (global catalog). */
  unidadesCatalogo: UnidadFormato[];
  periodo: PeriodoComparador;
  /** `fsj.jornada_actual(tenant)`, YYYY-MM-DD. */
  jornada: string;
  zonaHoraria: string;
  /** Start of the periodo; `null` for the whole history. */
  inicio: Date | null;
  /** The outlier band the repository applied in SQL; `null` = nothing flagged. */
  limites: LimitesAtipicos | null;
  /** Partidas with cost > 0 of the droga in the period, all proveedores (the base of the median). */
  partidasConCosto: number;
  agregados: AgregadoProveedorCrudo[];
  /** Up to `PARTIDAS_DETALLE_MAX` latest partidas of EACH proveedor, newest first. */
  partidas: PartidaComparadorCruda[];
}

export interface PartidaDetalleComparador {
  id: string;
  lote: string;
  fechaIngreso: Date;
  /** Recorded quantity, in the droga's unidad base. */
  cantidadInicial: string;
  /** Cost per DISPLAY unit. */
  costo: string;
  /** Cost 0: shown, but excluded from every metric. */
  costoCero: boolean;
  atipica: boolean;
}

export interface FilaProveedorComparador {
  proveedorId: string;
  razonSocial: string;
  deBaja: boolean;
  /** Latest cost per DISPLAY unit; `null` when every partida of the period has cost 0. */
  ultimoCosto: string | null;
  /** The último costo itself is an outlier (outside the droga's band): it never takes "Más barato" nor sets the minimum. */
  ultimoAtipico: boolean;
  ultimaCompra: Date | null;
  /** Width (percent) of the bar of `ultimoCosto`; `null` without cost. */
  barraPorcentaje: string | null;
  /** Against the cheapest vigente proveedor; `null` for the cheapest itself, a baja proveedor or a row without cost. */
  diferencia: DiferenciaCosto | null;
  promedioPonderado: string | null;
  costoMin: string | null;
  costoMax: string | null;
  partidasTotal: number;
  partidasConCosto: number;
  partidasCostoCero: number;
  partidasAtipicas: number;
  esMasBarato: boolean;
  esAntiguo: boolean;
  /** At least one of the proveedor's partidas is an outlier. */
  revisar: boolean;
  partidas: PartidaDetalleComparador[];
  /** There are more partidas than the `partidas` shown. */
  partidasHayMas: boolean;
}

export interface ComparacionCostos {
  droga: DrogaComparador;
  unidadBase: UnidadFormato;
  /** Unit the costs are shown per. */
  unidadMostrada: UnidadFormato;
  /** `true` when `unidadMostrada` is not the unidad base (the costs were converted). */
  convertida: boolean;
  /** Options of the "Mostrar costo por" select; `seleccionada` is the `valor` in force. */
  opcionesUnidad: OpcionUnidadCosto[];
  unidadSeleccionada: string;
  periodo: PeriodoComparador;
  inicioPeriodo: Date | null;
  zonaHoraria: string;
  jornada: string;
  /** Ranked: vigentes by ascending último costo, then the ones without cost, then the baja proveedores. */
  proveedores: FilaProveedorComparador[];
  /** Partidas with cost 0 left out of the metrics, all proveedores. */
  partidasCostoCero: number;
  /** Fewer than 2 VIGENTE proveedores with a cost (and at least one row): nothing to compare against. */
  sinOtrosProveedores: boolean;
  /** Catalog rows of the droga's magnitude, to format the quantities of the detail. */
  unidadesCatalogo: UnidadFormato[];
}

// ============================================================================
// Assembly
// ============================================================================

interface FilaIntermedia {
  agregado: AgregadoProveedorCrudo;
  deBaja: boolean;
  ultimoBase: Decimal | null;
}

function compararFilas(a: FilaIntermedia, b: FilaIntermedia): number {
  if (a.deBaja !== b.deBaja) return a.deBaja ? 1 : -1;
  if ((a.ultimoBase === null) !== (b.ultimoBase === null)) return a.ultimoBase === null ? 1 : -1;
  if (a.ultimoBase && b.ultimoBase) {
    const porCosto = a.ultimoBase.comparedTo(b.ultimoBase);
    if (porCosto !== 0) return porCosto;
  }
  return a.agregado.razonSocial.localeCompare(b.agregado.razonSocial, "es") || a.agregado.proveedorId.localeCompare(b.agregado.proveedorId);
}

/**
 * The comparison table: ranking, differences, weighted averages, flags and
 * the expandable detail, from the repository's raw rows.
 *
 *  - Ranking: vigentes by ascending último costo (ties by razón social), then
 *    vigentes without any cost, then baja proveedores (same inner order).
 *  - "Más barato" = the lowest último costo among the VIGENTES whose último
 *    costo is not an outlier, and only when at least two VIGENTES have a cost;
 *    ties all carry it. An outlier último costo never wins nor sets the minimum
 *    the difference column uses (if every one is an outlier, nobody wins). A
 *    baja proveedor is shown but never ranked: no badge, no difference. A
 *    difference is only shown for a cost ABOVE the minimum.
 *  - Bars are scaled by the largest último costo among vigentes that are not
 *    outliers (all rows with cost when none qualifies); a cost above the scale
 *    is drawn at 100%.
 *  - Costs are compared per unidad base (same droga, same unit) and converted
 *    to the display unit afterwards; the conversion is monotonic.
 */
export function armarComparacion(cruda: ComparacionCruda, unidadPedida: string | null): ComparacionCostos {
  const { seleccionada, opciones } = resolverUnidadCosto(cruda.unidadBase, cruda.unidadesCatalogo, unidadPedida);
  const mostrada = seleccionada.unidad;
  const aMostrada = (costoBase: string | Decimal): string => convertirCosto(costoBase, cruda.unidadBase, mostrada).toFixed();

  const filas: FilaIntermedia[] = cruda.agregados
    .map((agregado) => ({ agregado, deBaja: agregado.fechaBaja !== null, ultimoBase: agregado.ultimoCosto === null ? null : dec(agregado.ultimoCosto) }))
    .sort(compararFilas);

  const atipicoUltimo = (f: FilaIntermedia): boolean => f.agregado.ultimoCosto !== null && esCostoAtipico(f.agregado.ultimoCosto, cruda.limites);
  const vigentesConCosto = filas.filter((f) => !f.deBaja && f.ultimoBase !== null);
  const comparables = vigentesConCosto.filter((f) => !atipicoUltimo(f)).map((f) => f.ultimoBase!);
  const minimoBase = comparables.length > 0 ? Decimal.min(...comparables) : null;
  const conCosto = filas.filter((f) => f.ultimoBase !== null).map((f) => f.ultimoBase!);
  const maximoBase = comparables.length > 0 ? Decimal.max(...comparables) : conCosto.length > 0 ? Decimal.max(...conCosto) : null;
  const hayContraQuienComparar = vigentesConCosto.length >= 2;

  const partidasPorProveedor = new Map<string, PartidaComparadorCruda[]>();
  for (const partida of cruda.partidas) {
    const lista = partidasPorProveedor.get(partida.proveedorId) ?? [];
    lista.push(partida);
    partidasPorProveedor.set(partida.proveedorId, lista);
  }

  const proveedores: FilaProveedorComparador[] = filas.map((fila) => {
    const { agregado: a, deBaja, ultimoBase } = fila;
    const ultimoAtipico = atipicoUltimo(fila);
    const esMasBarato = hayContraQuienComparar && !deBaja && !ultimoAtipico && ultimoBase !== null && minimoBase !== null && ultimoBase.equals(minimoBase);
    const comparable = hayContraQuienComparar && !deBaja && ultimoBase !== null && minimoBase !== null && ultimoBase.greaterThan(minimoBase);
    const promedio = promedioPonderado(a.importeConCosto, a.cantidadConCosto);
    const detalle = (partidasPorProveedor.get(a.proveedorId) ?? []).slice(0, PARTIDAS_DETALLE_MAX).map((p): PartidaDetalleComparador => {
      const costoCero = !dec(p.costoUnitario).greaterThan(0);
      return {
        id: p.id,
        lote: p.lote,
        fechaIngreso: p.fechaIngreso,
        cantidadInicial: p.cantidadInicial,
        costo: aMostrada(p.costoUnitario),
        costoCero,
        atipica: esCostoAtipico(p.costoUnitario, cruda.limites),
      };
    });

    return {
      proveedorId: a.proveedorId,
      razonSocial: a.razonSocial,
      deBaja,
      ultimoCosto: ultimoBase ? aMostrada(ultimoBase) : null,
      ultimoAtipico,
      ultimaCompra: ultimoBase ? a.ultimaCompra : null,
      barraPorcentaje: ultimoBase && maximoBase ? porcentajeBarra(ultimoBase, maximoBase) : null,
      diferencia: comparable ? diferenciaContraMinimo(aMostrada(ultimoBase), aMostrada(minimoBase)) : null,
      promedioPonderado: promedio ? aMostrada(promedio) : null,
      costoMin: a.costoMin === null ? null : aMostrada(a.costoMin),
      costoMax: a.costoMax === null ? null : aMostrada(a.costoMax),
      partidasTotal: a.partidasTotal,
      partidasConCosto: a.partidasConCosto,
      partidasCostoCero: a.partidasCostoCero,
      partidasAtipicas: a.partidasAtipicas,
      esMasBarato,
      esAntiguo: ultimoBase !== null && a.ultimaCompra !== null && esCompraAntigua(a.ultimaCompra, cruda.jornada, cruda.zonaHoraria),
      revisar: a.partidasAtipicas > 0,
      partidas: detalle,
      partidasHayMas: a.partidasTotal > detalle.length,
    };
  });

  return {
    droga: cruda.droga,
    unidadBase: cruda.unidadBase,
    unidadMostrada: mostrada,
    convertida: mostrada.id !== cruda.unidadBase.id,
    opcionesUnidad: opciones,
    unidadSeleccionada: seleccionada.valor,
    periodo: cruda.periodo,
    inicioPeriodo: cruda.inicio,
    zonaHoraria: cruda.zonaHoraria,
    jornada: cruda.jornada,
    proveedores,
    partidasCostoCero: cruda.agregados.reduce((suma, a) => suma + a.partidasCostoCero, 0),
    sinOtrosProveedores: proveedores.length > 0 && !hayContraQuienComparar,
    unidadesCatalogo: cruda.unidadesCatalogo,
  };
}
