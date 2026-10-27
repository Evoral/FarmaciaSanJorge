/**
 * Typed registry of the per-tenant `fsj.parametro` rows this module knows
 * how to show/edit (FASE 3 point 3.10b, extended by FASE 5 point 5.7).
 * Deliberately NOT a generic arbitrary-key editor -- the plan says "list
 * and edit the per-tenant parameters that exist", and today that means the
 * two weighing parameters seeded by migration 0012 / scripts/create-tenant.ts
 * (`precision_balanza`, `exceso_pesada_porcentaje` -- openspec/specs/ficha-tecnica/spec.md
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
import { numeroONull } from "@/shared/decimal/numero-ingresado";
import { ALICUOTA_IVA_POR_DEFECTO, alicuotaIvaSchema } from "@/modules/costos-proveedor/domain/costo-proveedor";
import { DIAS_RETIRO_VENCIDO_DEFAULT, DIAS_RETIRO_VENCIDO_MAX } from "@/modules/entregas/domain/retiro-vencido";
import { MESES_VENCIMIENTO_PREPARADO_MAX } from "@/modules/preparaciones/domain/vencimiento";
import { DIAS_RELEVAMIENTO_INICIAL_DEFAULT, DIAS_RELEVAMIENTO_INICIAL_MAX } from "@/modules/stock/domain/existencia-inicial";

export const PARAMETRO_CLAVES = [
  "precision_balanza",
  "exceso_pesada_porcentaje",
  "tolerancia_pesada_porcentaje",
  "dias_alerta_vencimiento_partida",
  "plazo_firma_dias",
  "plazo_archivo_comun_anios",
  "plazo_archivo_controladas_anios",
  "meses_vencimiento_preparado",
  "dias_retiro_vencido",
  "dias_relevamiento_inicial",
  "alicuota_iva_porcentaje",
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
  // As the user types it (comma decimals); an ambiguous "1.500" is not a number here either.
  const numero = numeroONull(trimmed);
  if (numero === null) return null;
  const parsed = new Decimal(numero);
  return parsed.isFinite() ? parsed : null;
}

/**
 * `precision_balanza` (openspec/specs/ficha-tecnica/spec.md R8: "cantidadAPesar =
 * cantidadConExceso redondeada a múltiplo de precisionBalanza"). Must be >
 * 0 AND one of the exhaustive allowed set {0.1, 0.01, 0.001} -- per task
 * instruction ("such as 0.1, 0.01 o 0.001", treated as the exhaustive
 * allowed set; openspec/specs/ficha-tecnica/spec.md documents only the DEFAULT
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

/** `exceso_pesada_porcentaje` (openspec/specs/ficha-tecnica/spec.md R7): a percentage, 0-100 inclusive. */
function validarExcesoPesadaPorcentaje(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (valor.lessThan(0) || valor.greaterThan(100)) {
    return { ok: false, error: "Debe estar entre 0 y 100." };
  }
  return { ok: true, valor };
}

/** `tolerancia_pesada_porcentaje` (openspec/specs/pesada-real/spec.md): a percentage, 0-100 inclusive. */
function validarToleranciaPesadaPorcentaje(valorRaw: string): ValidacionParametro {
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

/** `dias_relevamiento_inicial` (openspec/specs/existencia-inicial/spec.md R6): an integer between 1 and three months. */
function validarDiasRelevamientoInicial(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (!valor.isInteger() || valor.lessThan(1) || valor.greaterThan(DIAS_RELEVAMIENTO_INICIAL_MAX)) {
    return { ok: false, error: `Debe ser un número entero entre 1 y ${DIAS_RELEVAMIENTO_INICIAL_MAX}.` };
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

/**
 * `meses_vencimiento_preparado` (DP-28 "Vencimiento", resolved 2026-10-07):
 * calendar months after its elaboración (the jornada of the confirmación)
 * that a preparado expires, snapshotted on `fsj.preparacion.fecha_vencimiento`
 * (migration 0068) when it is confirmed. An integer between 1 (a preparado
 * always expires some time after it is made) and
 * `MESES_VENCIMIENTO_PREPARADO_MAX` (a typo cannot push the date out of range).
 */
function validarMesesVencimientoPreparado(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (!valor.isInteger() || valor.lessThan(1) || valor.greaterThan(MESES_VENCIMIENTO_PREPARADO_MAX)) {
    return { ok: false, error: `Debe ser un número entero entre 1 y ${MESES_VENCIMIENTO_PREPARADO_MAX}.` };
  }
  return { ok: true, valor };
}

/**
 * `dias_retiro_vencido` (openspec/specs/retiro-vencido/spec.md RV1/RV10): days, counted from `receta.preparada_en`, after which
 * a PREPARADA receta nobody picked up moves to RETIRO_VENCIDO. An integer between 0 (disabled) and
 * `DIAS_RETIRO_VENCIDO_MAX`. Changing it recalculates nothing: the next daily run applies the new value.
 */
function validarDiasRetiroVencido(valorRaw: string): ValidacionParametro {
  const valor = parseDecimalOrNull(valorRaw);
  if (!valor) return { ok: false, error: "Debe ser un número válido." };
  if (!valor.isInteger() || valor.lessThan(0) || valor.greaterThan(DIAS_RETIRO_VENCIDO_MAX)) {
    return { ok: false, error: `Debe ser un número entero entre 0 y ${DIAS_RETIRO_VENCIDO_MAX}.` };
  }
  return { ok: true, valor };
}

/**
 * `alicuota_iva_porcentaje` (openspec/specs/costos-proveedor/spec.md R7a, migration 0107): the IVA a new costo de
 * proveedor starts with and a línea costed from partidas gets. Same rule as a costo's own alícuota (0-100), one source.
 */
function validarAlicuotaIvaPorcentaje(valorRaw: string): ValidacionParametro {
  const resultado = alicuotaIvaSchema.safeParse(valorRaw);
  if (!resultado.success) return { ok: false, error: resultado.error.issues[0]?.message ?? "Debe ser un número válido." };
  return { ok: true, valor: new Decimal(resultado.data) };
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
      "(openspec/specs/ficha-tecnica/spec.md, regla R8). Valores permitidos: 0.1, 0.01 o 0.001 (en gramos).",
    valorPorDefecto: "0.001",
    validar: validarPrecisionBalanza,
  },
  exceso_pesada_porcentaje: {
    clave: "exceso_pesada_porcentaje",
    tipo: "NUMERO",
    label: "Exceso de pesada",
    descripcion:
      "Porcentaje adicional aplicado sobre la cantidad teórica de cada línea de pesaje no manual, antes de redondear " +
      "(openspec/specs/ficha-tecnica/spec.md, regla R7). Debe estar entre 0 y 100.",
    valorPorDefecto: "0",
    validar: validarExcesoPesadaPorcentaje,
  },
  tolerancia_pesada_porcentaje: {
    clave: "tolerancia_pesada_porcentaje",
    tipo: "NUMERO",
    label: "Tolerancia de pesada",
    descripcion:
      "Desvío máximo, en porcentaje, entre la pesada real y la esperada de cada línea no manual (nunca menor que una " +
      "división de la balanza). Fuera de él se pide la co-firma del Director Técnico (openspec/specs/pesada-real/spec.md). Debe estar entre 0 y 100.",
    valorPorDefecto: "5",
    validar: validarToleranciaPesadaPorcentaje,
  },
  dias_alerta_vencimiento_partida: {
    clave: "dias_alerta_vencimiento_partida",
    tipo: "NUMERO",
    label: "Días de alerta de vencimiento de partidas",
    descripcion:
      "Cantidad de días, contados desde la jornada actual, dentro de los cuales una partida con saldo se muestra " +
      "en la alerta de \"próximas a vencer\". Debe ser un entero mayor que cero.",
    valorPorDefecto: "30",
    validar: validarDiasAlertaVencimientoPartida,
  },
  plazo_firma_dias: {
    clave: "plazo_firma_dias",
    tipo: "NUMERO",
    label: "Plazo de firma del cierre diario",
    descripcion:
      "Cantidad de días corridos desde la fecha de la jornada dentro de los cuales firmar el cierre diario se " +
      "considera en término. En 0 (valor por defecto), solo la firma en la misma " +
      "jornada se considera en término. Debe ser un entero mayor o igual que cero.",
    valorPorDefecto: "0",
    validar: validarPlazoFirmaDias,
  },
  plazo_archivo_comun_anios: {
    clave: "plazo_archivo_comun_anios",
    tipo: "NUMERO",
    label: "Plazo de archivo (recetas comunes)",
    descripcion:
      "Cantidad de años de conservación en archivo físico, contados desde el fin del período del lote, para lotes SIN " +
      "recetas controladas (a confirmar con la normativa de Mendoza). Debe ser un " +
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
      "al menos una receta controlada (a confirmar con la normativa de Mendoza). Debe " +
      "ser un entero mayor o igual que uno.",
    valorPorDefecto: "3",
    validar: validarPlazoArchivoAnios,
  },
  meses_vencimiento_preparado: {
    clave: "meses_vencimiento_preparado",
    tipo: "NUMERO",
    label: "Meses de vencimiento del preparado",
    descripcion:
      "Cantidad de meses, contados desde la fecha de elaboración, tras los cuales vence un preparado. La fecha se fija al " +
      "confirmar la preparación y se imprime en la etiqueta: cambiar este valor no modifica los preparados ya confirmados. " +
      `Debe ser un entero entre 1 y ${MESES_VENCIMIENTO_PREPARADO_MAX}.`,
    valorPorDefecto: "3",
    validar: validarMesesVencimientoPreparado,
  },
  dias_retiro_vencido: {
    clave: "dias_retiro_vencido",
    tipo: "NUMERO",
    label: "Días para el retiro",
    descripcion:
      "Cantidad de días, desde que la receta queda preparada, tras los cuales un preparado que nadie retiró pasa a " +
      "\"Retiro vencido\" (se puede reactivar si la persona aparece). El cambio se aplica en la próxima corrida diaria: " +
      "bajar el valor puede vencer varias recetas de golpe y subirlo no reactiva las ya vencidas. " +
      `Debe ser un entero entre 0 y ${DIAS_RETIRO_VENCIDO_MAX}; 0 desactiva el vencimiento.`,
    valorPorDefecto: String(DIAS_RETIRO_VENCIDO_DEFAULT),
    validar: validarDiasRetiroVencido,
  },
  dias_relevamiento_inicial: {
    clave: "dias_relevamiento_inicial",
    tipo: "NUMERO",
    label: "Plazo del relevamiento inicial",
    descripcion:
      "Cantidad de días, contados desde el primer cierre diario firmado, durante los cuales se puede cargar existencia " +
      "inicial, salvo que el Director Técnico cierre antes el relevamiento. Si el plazo ya venció, subirlo vuelve a " +
      "habilitar la carga hasta la nueva fecha; un relevamiento cerrado por el DT no se reabre nunca. " +
      `Debe ser un entero entre 1 y ${DIAS_RELEVAMIENTO_INICIAL_MAX} (tres meses).`,
    valorPorDefecto: DIAS_RELEVAMIENTO_INICIAL_DEFAULT,
    validar: validarDiasRelevamientoInicial,
  },
  alicuota_iva_porcentaje: {
    clave: "alicuota_iva_porcentaje",
    tipo: "NUMERO",
    label: "Alícuota de IVA",
    descripcion:
      "Porcentaje de IVA con el que empieza cada costo de proveedor nuevo (se puede cambiar en cada costo) y con el que se " +
      "cotizan las drogas sin costo de proveedor (sus partidas se cargan sin IVA). Cambiarlo no modifica los costos ya cargados " +
      "ni las cotizaciones ya calculadas. Debe estar entre 0 y 100.",
    valorPorDefecto: ALICUOTA_IVA_POR_DEFECTO,
    validar: validarAlicuotaIvaPorcentaje,
  },
};
