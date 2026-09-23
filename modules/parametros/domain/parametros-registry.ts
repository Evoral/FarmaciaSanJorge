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

export const PARAMETRO_CLAVES = ["precision_balanza", "exceso_pesada_porcentaje", "dias_alerta_vencimiento_partida"] as const;

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
};
