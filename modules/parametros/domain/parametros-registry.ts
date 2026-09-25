/**
 * Typed registry of the per-tenant `fsj.parametro` rows this module knows
 * how to show/edit (FASE 3 point 3.10b, extended by FASE 5 point 5.7).
 * Deliberately NOT a generic arbitrary-key editor -- the plan says "list
 * and edit the per-tenant parameters that exist", and today that means the
 * two weighing parameters seeded by migration 0012 / scripts/create-tenant.ts
 * (`precision_balanza`, `exceso_pesada_porcentaje` -- docs/specs/ficha-tecnica.md
 * "ParametrosPesaje", rules R7/R8) plus `dias_alerta_vencimiento_partida`
 * (DP-14, plan §9 M00 "Parámetros iniciales" -- FASE 5 point 5.7's alerta
 * de vencimiento window). Adding a known parameter means adding an entry
 * here -- `editar-parametro.ts` rejects any `clave` not in this registry,
 * so there is no way to write an arbitrary key through this module.
 *
 * `dias_alerta_vencimiento_partida` needs NO migration (`fsj.parametro` is
 * a plain key/value table, `PRIMARY KEY (tenant_id, clave)`, migration
 * 0001) -- only a new seed row (scripts/create-tenant.ts) and this entry.
 * `modules/stock/infrastructure/partida-repository.ts#getDiasAlertaVencimiento`
 * reads it directly (stock cannot import this module's infrastructure
 * layer -- module boundary) with the SAME defensive-fallback discipline as
 * `list-parametros.ts` below, for any tenant created before this clave
 * existed.
 *
 * `validar` is pure (no I/O) so it is directly unit-testable
 * (tests/unit/parametros-validacion.test.ts) and reused by both
 * `editar-parametro.ts` (server-side enforcement) and, if a future UI wants
 * client-side feedback, by the form component -- one source of truth for
 * each parameter's rule.
 */
import { Decimal } from "decimal.js";

export const PARAMETRO_CLAVES = [
  "precision_balanza",
  "exceso_pesada_porcentaje",
  "dias_alerta_vencimiento_partida",
  "plazo_firma_dias",
  "plazo_regularizacion_dias",
  "plazo_archivo_comun_anios",
  "plazo_archivo_controladas_anios",
] as const;

export type ParametroClave = (typeof PARAMETRO_CLAVES)[number];

const PARAMETRO_CLAVE_SET: ReadonlySet<string> = new Set(PARAMETRO_CLAVES);

export function isParametroClave(value: string): value is ParametroClave {
  return PARAMETRO_CLAVE_SET.has(value);
}

export type ValidacionParametro = { ok: true; valor: Decimal } | { ok: false; error: string };

function parseDecimalOrNull(valorRaw: string): Decimal | null {
  const trimmed = valorRaw.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new Decimal(trimmed);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * `precision_balanza` (docs/specs/ficha-tecnica.md R8: "cantidadAPesar =
 * cantidadConExceso redondeada a múltiplo de precisionBalanza"). Must be >
 * 0 AND one of the exhaustive allowed set {0.1, 0.01, 0.001} -- per task
 * instruction ("such as 0.1, 0.01 o 0.001", treated as the exhaustive
 * allowed set; docs/specs/ficha-tecnica.md documents only the DEFAULT
 * (0.001) and uses 0.01 in test case T6, it does not itself define a wider
 * range, so there is no spec evidence for anything beyond this task's
 * explicit set). A value that is numerically a power of ten but NOT in this
 * set (e.g. 1, 0.0001) is rejected on purpose -- the task is explicit that
 * this is not "any power of ten", it is exactly these three.
 */
const PRECISION_BALANZA_PERMITIDOS: readonly Decimal[] = ["0.1", "0.01", "0.001"].map((v) => new Decimal(v));

function validarPrecisionBalanza(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (valor.lessThanOrEqualTo(0)) return { ok: false, error: "Debe ser mayor que cero." };
  const permitido = PRECISION_BALANZA_PERMITIDOS.some((v) => valor.equals(v));
  if (!permitido) {
    return { ok: false, error: "Debe ser uno de los siguientes valores: 0.1, 0.01 o 0.001." };
  }
  return { ok: true, valor };
}

/** `exceso_pesada_porcentaje` (docs/specs/ficha-tecnica.md R7): a percentage, 0-100 inclusive. */
function validarExcesoPesadaPorcentaje(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (valor.lessThan(0) || valor.greaterThan(100)) {
    return { ok: false, error: "Debe estar entre 0 y 100." };
  }
  return { ok: true, valor };
}

/** `dias_alerta_vencimiento_partida` (DP-14, FASE 5 point 5.7): a positive integer. */
function validarDiasAlertaVencimientoPartida(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (!valor.isInteger() || valor.lessThanOrEqualTo(0)) {
    return { ok: false, error: "Debe ser un número entero mayor que cero." };
  }
  return { ok: true, valor };
}

/**
 * `plazo_firma_dias` (DP-18 RESUELTA, FASE 10 point 10.1): an integer >= 0
 * -- days of grace, from the jornada's own date, within which signing it is
 * still "en término" (INV-C18, `fsj.cierre_diario_calcular_fuera_de_termino`,
 * migration 0038). Zero (the default) reproduces the original rule: only
 * the SAME jornada counts as on time.
 */
function validarPlazoFirmaDias(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (!valor.isInteger() || valor.lessThan(0)) {
    return { ok: false, error: "Debe ser un número entero mayor o igual que cero." };
  }
  return { ok: true, valor };
}

/**
 * `plazo_regularizacion_dias` (DP-15 RESUELTA, FASE 11 punto 11.3): an
 * integer >= 0 -- days of grace, from the oldest asiento of a receta
 * without receta física recibida, within which it is not yet shown as
 * "vencida" in /regularizacion (INV-R10).
 */
function validarPlazoRegularizacionDias(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (!valor.isInteger() || valor.lessThan(0)) {
    return { ok: false, error: "Debe ser un número entero mayor o igual que cero." };
  }
  return { ok: true, valor };
}

/**
 * `plazo_archivo_comun_anios` / `plazo_archivo_controladas_anios` (DP-26
 * PARCIAL, FASE 12 point 12.1): years of physical retention counted from a
 * lote's `periodo_hasta` (`vencimiento = periodo_hasta + N años`) before it
 * is eligible for destruction. Both must be integers >= 1 -- a lote is
 * always kept AT LEAST one full year, and "controladas" must plausibly stay
 * >= "comun" at the UI/business level, but that cross-field relationship is
 * NOT enforced here (each parametro is edited independently, same as every
 * other entry in this registry) -- only the individual bound.
 */
function validarPlazoArchivoAnios(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (!valor.isInteger() || valor.lessThan(1)) {
    return { ok: false, error: "Debe ser un número entero mayor o igual que uno." };
  }
  return { ok: true, valor };
}

export interface ParametroDefinicion {
  clave: ParametroClave;
  tipo: "NUMERO";
  label: string;
  descripcion: string;
  /** Same default scripts/create-tenant.ts and migration 0012 seed for a new tenant -- used as a defensive fallback when a tenant somehow has no row yet (see list-parametros.ts). */
  valorPorDefecto: string;
  validar: (valorRaw: string) => ValidacionParametro;
}

export const PARAMETROS_REGISTRY: Record<ParametroClave, ParametroDefinicion> = {
  precision_balanza: {
    clave: "precision_balanza",
    tipo: "NUMERO",
    label: "Precisión de la balanza",
    descripcion:
      "Precisión de redondeo (múltiplo) usada al calcular la cantidad a pesar de cada línea de pesaje no manual " +
      "(docs/specs/ficha-tecnica.md, regla R8). Valores permitidos: 0.1, 0.01 o 0.001 (en gramos).",
    valorPorDefecto: "0.001",
    validar: validarPrecisionBalanza,
  },
  exceso_pesada_porcentaje: {
    clave: "exceso_pesada_porcentaje",
    tipo: "NUMERO",
    label: "Exceso de pesada",
    descripcion:
      "Porcentaje adicional aplicado sobre la cantidad teórica de cada línea de pesaje no manual, antes de redondear " +
      "(docs/specs/ficha-tecnica.md, regla R7). Debe estar entre 0 y 100.",
    valorPorDefecto: "0",
    validar: validarExcesoPesadaPorcentaje,
  },
  dias_alerta_vencimiento_partida: {
    clave: "dias_alerta_vencimiento_partida",
    tipo: "NUMERO",
    label: "Días de alerta de vencimiento de partidas",
    descripcion:
      "Cantidad de días, contados desde la jornada actual, dentro de los cuales una partida con saldo se muestra " +
      "en la alerta de \"próximas a vencer\" (DP-14, FASE 5 punto 5.7). Debe ser un entero mayor que cero.",
    valorPorDefecto: "30",
    validar: validarDiasAlertaVencimientoPartida,
  },
  plazo_firma_dias: {
    clave: "plazo_firma_dias",
    tipo: "NUMERO",
    label: "Plazo de firma del cierre diario",
    descripcion:
      "Cantidad de días corridos desde la fecha de la jornada dentro de los cuales firmar el cierre diario se " +
      "considera en término (DP-18, FASE 10 punto 10.1). En 0 (valor por defecto), solo la firma en la misma " +
      "jornada se considera en término. Debe ser un entero mayor o igual que cero.",
    valorPorDefecto: "0",
    validar: validarPlazoFirmaDias,
  },
  plazo_regularizacion_dias: {
    clave: "plazo_regularizacion_dias",
    tipo: "NUMERO",
    label: "Plazo de regularización de receta física",
    descripcion:
      "Cantidad de días corridos, contados desde el asiento más antiguo de la receta, dentro de los cuales una " +
      "receta sin receta física recibida todavía no se muestra como \"vencida\" en /regularizacion (DP-15, FASE 11 " +
      "punto 11.3, INV-R10). Debe ser un entero mayor o igual que cero.",
    valorPorDefecto: "7",
    validar: validarPlazoRegularizacionDias,
  },
  plazo_archivo_comun_anios: {
    clave: "plazo_archivo_comun_anios",
    tipo: "NUMERO",
    label: "Plazo de archivo (recetas comunes)",
    descripcion:
      "Cantidad de años de conservación en archivo físico, contados desde el fin del período del lote, para lotes SIN " +
      "recetas controladas (DP-26 PARCIAL, a confirmar con normativa de Mendoza, FASE 12 punto 12.1). Debe ser un " +
      "entero mayor o igual que uno.",
    valorPorDefecto: "2",
    validar: validarPlazoArchivoAnios,
  },
  plazo_archivo_controladas_anios: {
    clave: "plazo_archivo_controladas_anios",
    tipo: "NUMERO",
    label: "Plazo de archivo (recetas controladas)",
    descripcion:
      "Cantidad de años de conservación en archivo físico, contados desde el fin del período del lote, para lotes con " +
      "al menos una receta controlada (DP-26 PARCIAL, a confirmar con normativa de Mendoza, FASE 12 punto 12.1). Debe " +
      "ser un entero mayor o igual que uno.",
    valorPorDefecto: "3",
    validar: validarPlazoArchivoAnios,
  },
};
