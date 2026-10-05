/**
 * THE human (Spanish) label of every enum value the UI shows -- one map per
 * enum, next to shared/labels/field-labels.ts (field names). Screens never
 * render a raw code such as `UNGUENTO` or `PENDIENTE_PREPARACION`.
 *
 * Keyed by the Prisma enums (`@/generated/prisma/enums`, types only -- this
 * file is also bundled into client components), so a new enum value is a
 * type error here, and tests/unit/enum-labels.test.ts also checks every map
 * against the enum's runtime values.
 *
 * Enums whose map already lived in their module's domain keep it there
 * (TIPO_MAGNITUD_LABELS, TIPO_CONTROL_LABELS, MOTIVO_AJUSTE_LABELS,
 * MOTIVO_DEMORA_LABELS, ESTADO_LOTE_ARCHIVO_LABELS, JURISDICCION_MATRICULA_LABELS;
 * role names are per-tenant data, `rol.nombre`, since migration 0054); this file
 * holds the ones that were missing or duplicated.
 */
import type {
  EstadoPreparacion,
  EstadoReceta,
  EstadoUsuario,
  FormaFarmaceutica,
  ModoExpresion,
  OrigenReceta,
  TipoLibro,
  TipoMovimiento,
  TipoMovimientoContralor,
} from "@/generated/prisma/enums";

export const FORMA_FARMACEUTICA_LABELS: Readonly<Record<FormaFarmaceutica, string>> = {
  CAPSULA: "Cápsula",
  COMPRIMIDO: "Comprimido",
  CREMA: "Crema",
  GEL: "Gel",
  UNGUENTO: "Ungüento",
  JARABE: "Jarabe",
  SOLUCION: "Solución",
  SUSPENSION: "Suspensión",
  POLVO: "Polvo",
  OVULO: "Óvulo",
  SUPOSITORIO: "Supositorio",
  LOCION: "Loción",
};

export const MODO_EXPRESION_LABELS: Readonly<Record<ModoExpresion, string>> = {
  TOTAL: "Total",
  POR_DOSIS: "Por dosis",
  CS: "c.s.",
  CSP: "c.s.p.",
};

export const ESTADO_RECETA_LABELS: Readonly<Record<EstadoReceta, string>> = {
  PENDIENTE_PREPARACION: "Pendiente de preparación",
  EN_PREPARACION: "En preparación",
  PREPARADA: "Preparada",
  ENVIADA_PEND_FIRMA: "Enviada, pendiente de firma",
  ENTREGADA: "Entregada",
  ANULADA: "Anulada",
};

export const ESTADO_PREPARACION_LABELS: Readonly<Record<EstadoPreparacion, string>> = {
  INICIADA: "Iniciada",
  CONFIRMADA: "Confirmada",
  DESCARTADA: "Descartada",
};

export const ESTADO_USUARIO_LABELS: Readonly<Record<EstadoUsuario, string>> = {
  PENDIENTE_ACTIVACION: "Pendiente de activación",
  ACTIVO: "Activo",
  SUSPENDIDO: "Suspendido",
  BAJA: "Dado de baja",
};

export const ORIGEN_RECETA_LABELS: Readonly<Record<OrigenReceta, string>> = {
  PRESENCIAL: "Presencial",
  DIGITAL_PDF: "Digital (PDF o QR)",
  DIGITAL_FOTO: "Digital (foto)",
};

export const TIPO_LIBRO_LABELS: Readonly<Record<TipoLibro, string>> = {
  RECETARIO: "Recetario",
  PSICOTROPICO: "Psicotrópicos",
  ESTUPEFACIENTE: "Estupefacientes",
};

/** Stock movements (kardex, partida detail). */
export const TIPO_MOVIMIENTO_LABELS: Readonly<Record<TipoMovimiento, string>> = {
  INGRESO_COMPRA: "Ingreso de compra",
  EGRESO_PREPARACION: "Egreso por preparación",
  AJUSTE: "Ajuste",
};

/** Libro contralor movements. */
export const TIPO_MOVIMIENTO_CONTRALOR_LABELS: Readonly<Record<TipoMovimientoContralor, string>> = {
  APERTURA: "Apertura",
  INGRESO: "Ingreso",
  EGRESO: "Egreso",
  AJUSTE: "Ajuste",
};

/** Lookup for a value that may be outside the enum (old rows, a filter param): its label, or the value itself. */
export function etiquetaDe<K extends string>(labels: Readonly<Record<K, string>>, valor: string): string {
  return Object.hasOwn(labels, valor) ? labels[valor as K] : valor;
}
