/**
 * Pure domain logic for `fsj.lote_archivo_recetas` (FASE 12, M15, points
 * 12.1-12.3). No I/O here -- every date is a plain `YYYY-MM-DD` string
 * (Postgres `date`, never a JS `Date`, so there is no timezone conversion
 * to get wrong -- see this task's gotcha note on `jornadaDe()`/`now()`).
 *
 * User decision 1 (2026-09-24): the system keeps ALL digital data forever.
 * "Destrucción" here NEVER touches `receta`/`asiento`/adjuntos -- it is
 * purely the `lote_archivo_recetas.estado` state machine reaching
 * `DESTRUIDO`, which only records that the PHYSICAL papers were destroyed
 * (migration 0016's INV-D02/D05, defense in depth against exactly that).
 */

export const ESTADOS_LOTE_ARCHIVO = [
  "EN_ARCHIVO",
  "PLAZO_CUMPLIDO",
  "DESTRUCCION_SOLICITADA",
  "DESTRUCCION_AUTORIZADA",
  "DESTRUIDO",
] as const;

export type EstadoLoteArchivoValue = (typeof ESTADOS_LOTE_ARCHIVO)[number];

export const ESTADO_LOTE_ARCHIVO_LABELS: Readonly<Record<EstadoLoteArchivoValue, string>> = {
  EN_ARCHIVO: "En archivo",
  PLAZO_CUMPLIDO: "Plazo cumplido",
  DESTRUCCION_SOLICITADA: "Destrucción solicitada",
  DESTRUCCION_AUTORIZADA: "Destrucción autorizada",
  DESTRUIDO: "Destruido",
};

/**
 * `vencimiento = periodoHasta + N años` (user decision 1, N per
 * `incluyeControladas`, DP-26 PARCIAL) used to also be computed here in JS
 * for display, duplicating `archivo-repository.ts`'s SQL job-query
 * expression -- removed. `vencimiento`/`plazoCumplido` are now computed
 * ONLY in SQL (`archivo-repository.ts`'s `vencimientoFragment`, shared by
 * `moverPlazoCumplidoTenant` and the list/detail queries) so there is a
 * single source of truth and the two can never disagree. Verified against
 * a live Postgres that `date + make_interval(years => N)` clamps 29 Feb to
 * 28 Feb on a non-leap target year (same behavior the old JS clamp
 * implemented) -- see that file's module doc comment.
 */

export function puedeSolicitarDestruccion(estado: EstadoLoteArchivoValue): boolean {
  return estado === "PLAZO_CUMPLIDO";
}

export function puedeAutorizarDestruccion(estado: EstadoLoteArchivoValue): boolean {
  return estado === "DESTRUCCION_SOLICITADA";
}

export function puedeRegistrarDestruccion(estado: EstadoLoteArchivoValue): boolean {
  return estado === "DESTRUCCION_AUTORIZADA";
}

export function estaDestruido(estado: EstadoLoteArchivoValue): boolean {
  return estado === "DESTRUIDO";
}

/** M09 `EstadoReceta` values that make a receta archivable (migration 0016 INV-ARC-006) -- own copy, module boundary (see modules/entregas/infrastructure/entrega-repository.ts's doc comment for the same "own copy per module" discipline). */
export type EstadoRecetaArchivable = "ENTREGADA" | "ANULADA";

export interface RecetaCandidataArchivo {
  estado: string;
  recetaFisicaRecibida: boolean;
  loteArchivoId: string | null;
  /** `YYYY-MM-DD` (fecha_ingreso's date part in the tenant's zona_horaria -- computed by the repository, never by `new Date()` here). */
  fechaIngreso: string;
}

/**
 * User decision 4: eligible = ENTREGADA or ANULADA, `receta_fisica_recibida`,
 * not already archived, and `fecha_ingreso` within the lote's período.
 * ANULADA recetas that never received their physical copy are excluded by
 * the SAME `recetaFisicaRecibida` check -- "nothing to archive" (task's own
 * note) -- no separate branch needed.
 */
export function esRecetaElegibleParaArchivo(receta: RecetaCandidataArchivo, periodoDesde: string, periodoHasta: string): boolean {
  if (receta.loteArchivoId !== null) return false;
  if (!receta.recetaFisicaRecibida) return false;
  if (receta.estado !== "ENTREGADA" && receta.estado !== "ANULADA") return false;
  return receta.fechaIngreso >= periodoDesde && receta.fechaIngreso <= periodoHasta;
}

export type ValidacionFecha = { ok: true } | { ok: false; error: string };

/** 12.3b: registrar autorización (expediente + fecha_autorizacion, INV-D02). */
export function validarAutorizacionDestruccion(input: { expedienteAutorizacion: string; fechaAutorizacion: string; jornadaActual: string }): ValidacionFecha {
  if (input.expedienteAutorizacion.trim().length === 0) {
    return { ok: false, error: "El número de expediente es obligatorio." };
  }
  if (input.fechaAutorizacion > input.jornadaActual) {
    return { ok: false, error: "La fecha de autorización no puede ser futura." };
  }
  return { ok: true };
}

/** 12.3c: registrar destrucción (fecha_destruccion >= fecha_autorizacion, no futura). */
export function validarRegistroDestruccion(input: { fechaDestruccion: string; fechaAutorizacion: string; jornadaActual: string }): ValidacionFecha {
  if (input.fechaDestruccion > input.jornadaActual) {
    return { ok: false, error: "La fecha de destrucción no puede ser futura." };
  }
  if (input.fechaDestruccion < input.fechaAutorizacion) {
    return { ok: false, error: "La fecha de destrucción no puede ser anterior a la fecha de autorización." };
  }
  return { ok: true };
}
