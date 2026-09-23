/**
 * Spanish messages for the `INV-XXX` codes the confirmación transaction
 * (FASE 8 point 8.3) can surface from the DB, via `mapDbError`
 * (shared/errors/index.ts) -> `InvariantViolationError.invariantCode`.
 * `confirmar-preparacion.ts` is the ONLY place that turns one of these codes
 * into the message a farmacéutico actually reads -- same "one translation
 * table, source of truth in the code comment" discipline as
 * `modules/elaboracion/domain/mensajes-validacion.ts`.
 *
 * `mapDbError` extracts the code as `INV-` + everything up to the next
 * non-code character, so `INV-S10`, `INV-P04`, `INV-L08` etc. all match by
 * exact string. `toSafeError`'s own generic mapping is bypassed here on
 * purpose: this transaction is exactly the legal-core case the task calls
 * out for a CLEAR message, not a fixed generic one.
 */
export const MENSAJES_INVARIANTES_CONFIRMACION: Readonly<Record<string, string>> = {
  "INV-S02": "La partida seleccionada quedaría con saldo negativo: revisá las cantidades.",
  "INV-S03": "La partida seleccionada superaría su cantidad inicial: revisá las cantidades.",
  "INV-S10": "Una de las partidas elegidas está vencida: no se puede descontar stock de una partida vencida.",
  "INV-S12": "La cantidad a descontar no coincide con lo que exige la línea de pesaje: volvé a intentar la confirmación.",
  "INV-P01": "La preparación no tiene una ficha técnica válida.",
  "INV-P02": "Ya existe otra preparación activa para esta ficha técnica.",
  "INV-P04": "No se pudo vincular la preparación con su asiento en el libro recetario.",
  "INV-P05": "Esta preparación ya fue confirmada o descartada: no se puede volver a confirmar.",
  "INV-C03": "La jornada de hoy ya fue firmada por el Director Técnico: no se pueden registrar más preparaciones para el día de hoy.",
  "INV-L03": "El libro recetario del tenant no está disponible: contactá al administrador.",
  "INV-L04": "No se pudo asignar el número correlativo del asiento: volvé a intentar la confirmación.",
  "INV-L08": "Falta el asiento del libro contralor para una droga controlada: contactá al administrador.",
  "INV-L14": "El saldo del libro contralor quedaría negativo para esta droga.",
  "INV-L15": "Falta el asiento de apertura del libro contralor para esta droga: contactá al Director Técnico.",
  "INV-L16": "Falta el número de vale de adquisición requerido por el libro contralor.",
  "INV-L18": "El asiento original no admite un rectificativo en este momento.",
};

const MENSAJE_GENERICO = "No se pudo confirmar la preparación: se violó una regla del sistema. Contactá al administrador si el problema persiste.";

/** Maps an `InvariantViolationError.invariantCode` (e.g. `"INV-S10"`) to its Spanish message. Falls back to a generic message for a code not listed above. */
export function mensajeParaInvariante(codigo: string): string {
  return MENSAJES_INVARIANTES_CONFIRMACION[codigo] ?? MENSAJE_GENERICO;
}
