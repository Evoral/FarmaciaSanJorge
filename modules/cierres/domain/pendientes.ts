/**
 * DP-18d RESUELTA (user decision, 2026-09-24, FASE 10 point 10.1): a
 * jornada with NO asiento_recetario AND no asiento_contralor at all does
 * not require a signature and never appears in the pending list/alert --
 * signing it anyway (with `cantidad_asientos = 0`) stays possible (nothing
 * in the DB forbids it, `cierre_diario_cantidad_asientos_check` only
 * requires `>= 0`), it is just never forced.
 *
 * Pure -- the actual SQL in `../infrastructure/cierre-repository.ts#listJornadasPendientes`
 * already only selects fechas with at least one unsigned VIGENTE asiento
 * (recetario or contralor), so this function is the single place that
 * documents/enforces the RULE, directly unit-testable without a database.
 */
export interface JornadaConAsientos {
  fecha: string;
  cantidadRecetario: number;
  cantidadContralor: number;
}

/** `true` when this jornada has at least one unsigned VIGENTE asiento (recetario or contralor) and therefore belongs in the pending-signature list/alert. */
export function requiereFirma(jornada: JornadaConAsientos): boolean {
  return jornada.cantidadRecetario > 0 || jornada.cantidadContralor > 0;
}

/** Filters a list down to the jornadas that actually require a signature (DP-18d), preserving order. */
export function filtrarJornadasQueRequierenFirma(jornadas: readonly JornadaConAsientos[]): JornadaConAsientos[] {
  return jornadas.filter(requiereFirma);
}
