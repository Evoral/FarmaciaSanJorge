/**
 * Spanish messages for the `INV-XXX` codes `anularAsiento` (FASE 9, M12
 * point 9.2) can surface from the DB, via `mapDbError` ->
 * `InvariantViolationError.invariantCode`. Same "one translation table"
 * discipline as `modules/preparaciones/domain/mensajes-invariantes.ts` --
 * see that file's doc comment.
 */
export const MENSAJES_INVARIANTES_ANULACION: Readonly<Record<string, string>> = {
  "INV-L02": "La jornada del asiento ya está firmada; corresponde un asiento rectificativo.",
  "INV-L09": "El asiento ya no está vigente: no se puede anular de nuevo.",
  "INV-U05": "El Director Técnico indicado no está vigente hoy.",
};

const MENSAJE_GENERICO = "No se pudo anular el asiento: se violó una regla del sistema. Contactá al administrador si el problema persiste.";

export function mensajeParaInvarianteAnulacion(codigo: string): string {
  return MENSAJES_INVARIANTES_ANULACION[codigo] ?? MENSAJE_GENERICO;
}

/**
 * D1 (2026-09-23): Spanish messages for `rectificarAsiento`'s own INV-XXX
 * codes (migrations 0014/0033/0034). Same "one translation table"
 * discipline as `MENSAJES_INVARIANTES_ANULACION` above.
 */
export const MENSAJES_INVARIANTES_RECTIFICACION: Readonly<Record<string, string>> = {
  "INV-L18": "El asiento original debe ser de origen sistema y pertenecer a una jornada ya firmada, anterior a la de hoy.",
  "INV-L21": "No se pudo autorizar el asiento rectificativo: falta o es inválida la autorización.",
  "INV-U05": "El Director Técnico indicado no está vigente hoy.",
};

const MENSAJE_GENERICO_RECTIFICACION =
  "No se pudo generar el asiento rectificativo: se violó una regla del sistema. Contactá al administrador si el problema persiste.";

export function mensajeParaInvarianteRectificacion(codigo: string): string {
  return MENSAJES_INVARIANTES_RECTIFICACION[codigo] ?? MENSAJE_GENERICO_RECTIFICACION;
}
