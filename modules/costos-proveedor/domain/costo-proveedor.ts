/**
 * Pure rules for `costo_proveedor` (openspec/specs/costos-proveedor/spec.md, R1-R12,
 * R26). NO I/O, NO Prisma -- same discipline as modules/precios/domain/regla-precio.ts.
 *
 * A costo de proveedor is the REFERENCE price a supplier quotes for a droga,
 * used only to quote (never a purchase; the real cost stays in
 * `partida.costo_unitario`). It is stored twice:
 *
 *   - `precioInformado`: exactly as written on the list, per 1 `unidadPrecio`
 *     (e.g. $ 40.898 per kg), net of IVA, in pesos (R3, R7);
 *   - `costoUnitario`: that price per the droga's unidad base (e.g. $ 0,040898
 *     per mg), rounded to 10 decimals half-up (R4) -- the same convention as
 *     `partida.costo_unitario`, so a cotización multiplies the same way
 *     whatever the cost source.
 *
 * Plus its IVA (R7a, migration 0107): `alicuotaIva` (percent, the tenant's
 * `alicuota_iva_porcentaje` parametro unless the user changed it for this
 * costo) and both prices with it, `precioInformadoConIva` and
 * `costoUnitarioConIva` (`calcularConIva`). A cotización multiplies the
 * latter.
 *
 * Dates (`fechaPrecio`) are `YYYY-MM-DD` strings (the jornada convention of
 * the rest of the code base), compared lexicographically.
 */
import { z } from "zod";
import { Decimal, dec } from "@/shared/decimal";
import { convertirCantidad, mismaMagnitud, type UnidadDeConversion } from "@/shared/decimal/convertir-unidad";
import { DomainError } from "@/shared/errors";
import { decimalString, positiveDecimalString, uuid } from "@/shared/validation";

// ============================================================================
// Unit conversion (R4, R5, R6)
// ============================================================================

/** Decimals kept in `costoUnitario` (R4). Wider than `partida.costo_unitario` (6): a price per kg in mg is a very small number. */
export const COSTO_DECIMALES = 10;

/** The `tipo_magnitud` values of `fsj.unidad_medida` (migration 0006). */
export type TipoMagnitudCosto = "MASA" | "VOLUMEN" | "UNIDADES";

/**
 * R6: the default unidad de precio by the droga's magnitud, as the
 * `fsj.unidad_medida.codigo` of the seeded catalog (migration 0006): masa ->
 * kg, volumen -> L, unidades -> u. Editable per row.
 */
const CODIGO_UNIDAD_PRECIO_POR_DEFECTO: Readonly<Record<TipoMagnitudCosto, string>> = {
  MASA: "KILOGRAMO",
  VOLUMEN: "LITRO",
  UNIDADES: "UNIDAD",
};

/** `codigo` of the unidad de precio a row starts with, by the droga's magnitud (R6). */
export function unidadPrecioPorDefecto(tipoMagnitud: TipoMagnitudCosto): string {
  return CODIGO_UNIDAD_PRECIO_POR_DEFECTO[tipoMagnitud];
}

/** The `fsj.unidad_medida` fields a costo row needs, besides what a conversion needs. */
export interface UnidadParaCosto extends UnidadDeConversion {
  id: string;
  codigo: string;
  /** `null` = vigente. */
  fechaBaja: Date | null;
}

const MENSAJE_OTRA_MAGNITUD = "La unidad del precio debe ser de la misma magnitud que la unidad base de la droga (no hay conversión por densidad).";

/**
 * R4: `costoUnitario = precioInformado / factor(1 unidadPrecio -> unidadBase)`,
 * with the arithmetic of `fsj.convertir` (`convertirCantidad`), rounded to
 * `COSTO_DECIMALES` half-up. Returns a plain decimal string (never an
 * exponent). Throws a `DomainError` across magnitudes (R5) -- use
 * `validarFilaCosto` for a non-throwing check with the other row rules.
 *
 * Example: 40898 per kg, unidad base mg -> 1 kg = 1.000.000 mg -> 0.040898.
 */
export function calcularCostoUnidadBase(precioInformado: Decimal | string, unidadPrecio: UnidadDeConversion, unidadBase: UnidadDeConversion): string {
  if (!mismaMagnitud(unidadPrecio, unidadBase)) throw new DomainError(MENSAJE_OTRA_MAGNITUD);
  const factor = convertirCantidad("1", unidadPrecio, unidadBase);
  return dec(precioInformado).dividedBy(factor).toDecimalPlaces(COSTO_DECIMALES, Decimal.ROUND_HALF_UP).toFixed();
}

// ============================================================================
// IVA (R7a)
// ============================================================================

/** The `alicuota_iva_porcentaje` parametro's default (migration 0107, scripts/create-tenant.ts), in percent. */
export const ALICUOTA_IVA_POR_DEFECTO = "21";

/** Decimals of `precioInformadoConIva` (the precio informado is shown with up to 6, presentacion.ts). */
const PRECIO_CON_IVA_DECIMALES = 6;

/** `alicuotaIva`: a percentage between 0 and 100 inclusive, as typed. Output: the canonical decimal string. */
export const alicuotaIvaSchema = z
  .string()
  .trim()
  .min(1, "Ingresá la alícuota de IVA.")
  .pipe(decimalString)
  .refine((value) => value.greaterThanOrEqualTo(0) && value.lessThanOrEqualTo(100), "La alícuota de IVA debe estar entre 0 y 100.")
  .transform((value) => value.toFixed());

/**
 * The raw `fsj.parametro.valor` of `alicuota_iva_porcentaje`, or `null` when missing or not a percentage: callers then
 * use `ALICUOTA_IVA_POR_DEFECTO` (same defensive fallback as every other parametro read).
 */
export function parsearAlicuotaIva(valorRaw: string | null | undefined): string | null {
  if (valorRaw === null || valorRaw === undefined) return null;
  const resultado = alicuotaIvaSchema.safeParse(valorRaw);
  return resultado.success ? resultado.data : null;
}

/** `monto * (1 + alicuota / 100)`, exact (no rounding): what a cotización applies to a partida's cost (R27). */
export function aplicarIva(monto: Decimal | string, alicuotaIva: Decimal | string): Decimal {
  return dec(monto).times(dec(alicuotaIva).dividedBy(100).plus(1));
}

/**
 * R7a: both prices of a costo with its IVA, as stored (the DB CHECKs of migration 0107 recompute them the same
 * way): the precio informado rounded to 6 decimals, the costo per unidad base to `COSTO_DECIMALES`, half-up.
 */
export function calcularConIva(input: { precioInformado: Decimal | string; costoUnitario: Decimal | string; alicuotaIva: Decimal | string }): {
  precioInformadoConIva: string;
  costoUnitarioConIva: string;
} {
  return {
    precioInformadoConIva: aplicarIva(input.precioInformado, input.alicuotaIva).toDecimalPlaces(PRECIO_CON_IVA_DECIMALES, Decimal.ROUND_HALF_UP).toFixed(),
    costoUnitarioConIva: aplicarIva(input.costoUnitario, input.alicuotaIva).toDecimalPlaces(COSTO_DECIMALES, Decimal.ROUND_HALF_UP).toFixed(),
  };
}

// ============================================================================
// Row validation (R3, R5, R8)
// ============================================================================

/** `YYYY-MM-DD` that is also a real calendar date (no 2026-02-31). */
export function esFechaIsoReal(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A price as typed: a plain decimal (no exponent, no hex) strictly greater than zero. Output: the canonical decimal string, exact (no rounding). */
export const precioInformadoSchema = z
  .string()
  .trim()
  .min(1, "Ingresá el precio.")
  // As typed (`interpretarNumero` inside `positiveDecimalString`): comma decimals, an ambiguous "1.500" refused.
  .pipe(positiveDecimalString)
  .transform((value) => value.toFixed());

/** `fecha_precio`: a real `YYYY-MM-DD` date not after the jornada actual (R8). `jornadaActual` comes from the server (`fsj.jornada_actual`), never the client. */
export function fechaPrecioSchema(jornadaActual: string) {
  return z
    .string()
    .trim()
    .refine(esFechaIsoReal, "La fecha del precio debe ser una fecha válida (AAAA-MM-DD).")
    .refine((fecha) => fecha <= jornadaActual, "La fecha del precio no puede ser posterior a hoy.");
}

/** Optional free text: trimmed, empty -> `null` (the DB rejects blank strings). */
const textoOpcional = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value ? value : null));

/**
 * One costo row as submitted (manual entry or one confirmed import row), R3 /
 * R24. Shape only: whether the unidad exists, is vigente and shares the
 * droga's magnitud needs the loaded catalog -- see `validarFilaCosto`.
 */
export function filaCostoSchema(jornadaActual: string) {
  return z.object({
    drogaId: uuid,
    precioInformado: precioInformadoSchema,
    unidadPrecioId: uuid,
    fechaPrecio: fechaPrecioSchema(jornadaActual),
    /**
     * R7a: `null`/absent = not chosen (a list import): the command keeps the pair's vigente alícuota, else the
     * tenant's `alicuota_iva_porcentaje`.
     */
    alicuotaIva: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), alicuotaIvaSchema.nullish()).transform((value) => value ?? null),
    /** The product text as written on the supplier's list (imports only). */
    descripcionProveedor: textoOpcional,
    motivo: textoOpcional,
  });
}

export type FilaCosto = z.output<ReturnType<typeof filaCostoSchema>>;

export type ProblemaFilaCosto = "UNIDAD_DE_BAJA" | "OTRA_MAGNITUD" | "COSTO_NULO";

export type ResultadoFilaCosto = { ok: true; costoUnitario: string } | { ok: false; problema: ProblemaFilaCosto; mensaje: string };

/**
 * The row rules that need the units: the unidad de precio must be vigente
 * (R5) and of the SAME magnitud as the droga's unidad base (R5); and the
 * converted cost must stay > 0 after rounding to `COSTO_DECIMALES` (the DB
 * CHECK `costo_unitario > 0`: a price so low that it rounds to zero is
 * refused with a message instead of a constraint error). On success returns
 * the `costoUnitario` to store.
 */
export function validarFilaCosto(input: { precioInformado: string; unidadPrecio: UnidadParaCosto; unidadBase: UnidadDeConversion }): ResultadoFilaCosto {
  const { precioInformado, unidadPrecio, unidadBase } = input;
  if (!mismaMagnitud(unidadPrecio, unidadBase)) return { ok: false, problema: "OTRA_MAGNITUD", mensaje: MENSAJE_OTRA_MAGNITUD };
  if (unidadPrecio.fechaBaja !== null) return { ok: false, problema: "UNIDAD_DE_BAJA", mensaje: "La unidad del precio está dada de baja." };
  const costoUnitario = calcularCostoUnidadBase(precioInformado, unidadPrecio, unidadBase);
  if (!dec(costoUnitario).greaterThan(0)) {
    return { ok: false, problema: "COSTO_NULO", mensaje: "El precio es demasiado bajo: convertido a la unidad base de la droga queda en cero." };
  }
  return { ok: true, costoUnitario };
}

// ============================================================================
// Versioning (R2, R9, R10)
// ============================================================================

/** The fields of a costo that decide how a new one relates to it (R9, R10). */
export interface ClaveVersionadoCosto {
  precioInformado: Decimal | string;
  unidadPrecioId: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
  /** R7a. Absent on both sides = the same. */
  alicuotaIva?: Decimal | string;
}

export interface CostoVigenteParaVersionar extends ClaveVersionadoCosto {
  id: string;
}

export type PlanVersionado =
  /** There is no vigente costo for the pair: insert the first version. */
  | { tipo: "INSERTAR" }
  /** Close `cerrarId` (vigente_hasta = the new version's vigente_desde) and insert the new version (R2). */
  | { tipo: "REEMPLAZAR"; cerrarId: string }
  /** Same precio informado, unidad, fecha and alícuota de IVA as the vigente: nothing to write (R10). */
  | { tipo: "SIN_CAMBIOS" }
  /** The vigente has a later fecha_precio: an older price never overwrites a newer one (R9). */
  | { tipo: "RECHAZAR"; motivo: "MAS_ANTIGUA" };

/**
 * What to do when `nuevo` arrives for a (droga, proveedor) pair whose
 * vigente costo is `vigente` (`null` = none). Pure; the command re-evaluates
 * it after locking the pair's vigente row (R9, R23).
 *
 * Order matters: an older date is refused even when the price is equal (R9);
 * the same price with a LATER date is a new version (R10: the price is
 * confirmed as of a newer date, which feeds the antigüedad shown and R26).
 */
export function planVersionar(input: { vigente: CostoVigenteParaVersionar | null; nuevo: ClaveVersionadoCosto }): PlanVersionado {
  const { vigente, nuevo } = input;
  if (!vigente) return { tipo: "INSERTAR" };
  if (nuevo.fechaPrecio < vigente.fechaPrecio) return { tipo: "RECHAZAR", motivo: "MAS_ANTIGUA" };
  const igual =
    dec(nuevo.precioInformado).equals(dec(vigente.precioInformado)) &&
    nuevo.unidadPrecioId === vigente.unidadPrecioId &&
    nuevo.fechaPrecio === vigente.fechaPrecio &&
    dec(nuevo.alicuotaIva ?? 0).equals(dec(vigente.alicuotaIva ?? 0));
  if (igual) return { tipo: "SIN_CAMBIOS" };
  return { tipo: "REEMPLAZAR", cerrarId: vigente.id };
}

// ============================================================================
// Import preview helpers (R18)
// ============================================================================

/**
 * R18 "duplicada": indices (ascending) of every row whose droga appears more
 * than once in the file -- ALL rows of the group are flagged, so the user
 * must omit all but one. Rows with no droga yet (`null`, "sin asociar") never
 * collide.
 */
export function detectarDuplicados(filas: readonly { drogaId: string | null | undefined }[]): number[] {
  const porDroga = new Map<string, number[]>();
  filas.forEach((fila, indice) => {
    if (!fila.drogaId) return;
    const grupo = porDroga.get(fila.drogaId);
    if (grupo) grupo.push(indice);
    else porDroga.set(fila.drogaId, [indice]);
  });
  return [...porDroga.values()]
    .filter((grupo) => grupo.length > 1)
    .flat()
    .sort((a, b) => a - b);
}

// ============================================================================
// Which costo a cotización uses (R26)
// ============================================================================

/** A vigente costo of one droga, with what R26 needs to choose among proveedores. */
export interface CandidatoCostoProveedor {
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
  vigenteDesde: Date;
  /** The proveedor was given de baja: its costo is NOT usable (R26). */
  proveedorDeBaja: boolean;
}

/**
 * R26: among the vigente costos of a droga whose proveedor is not de baja,
 * the one with the latest `fechaPrecio`; a tie goes to the latest
 * `vigenteDesde`; a remaining tie keeps the first candidate (callers pass a
 * deterministic order). `null` when nothing is usable -- the cotización then
 * falls back to partida costing (R27).
 */
export function elegirCostoProveedor<T extends CandidatoCostoProveedor>(candidatos: readonly T[]): T | null {
  let elegido: T | null = null;
  for (const candidato of candidatos) {
    if (candidato.proveedorDeBaja) continue;
    if (elegido === null || esMejorCandidato(candidato, elegido)) elegido = candidato;
  }
  return elegido;
}

function esMejorCandidato(candidato: CandidatoCostoProveedor, actual: CandidatoCostoProveedor): boolean {
  if (candidato.fechaPrecio !== actual.fechaPrecio) return candidato.fechaPrecio > actual.fechaPrecio;
  return candidato.vigenteDesde.getTime() > actual.vigenteDesde.getTime();
}
