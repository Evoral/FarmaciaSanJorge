/**
 * Spanish messages for the `INV-XXX` codes `firmarCierre` (FASE 10, M13a
 * point 10.1) can surface from the DB, via `mapDbError` ->
 * `InvariantViolationError.invariantCode`. Same "one translation table"
 * discipline as `modules/libro/domain/mensajes-invariantes.ts` -- see that
 * file's doc comment.
 */
export const MENSAJES_INVARIANTES_FIRMA: Readonly<Record<string, string>> = {
  "INV-C01": "Esa jornada ya fue firmada.",
  "INV-C18": "La firma quedaría fuera de término: indicá el motivo de la demora.",
  "INV-C19": "No se puede firmar fuera de orden: hay una jornada anterior sin firmar (recetario o contralor).",
  "INV-C21": "No se puede firmar una jornada futura.",
  "INV-U04": "No tenés una designación de Director Técnico vigente para esa fecha.",
};

const MENSAJE_GENERICO_FIRMA =
  "No se pudo firmar el cierre: se violó una regla del sistema. Contactá al administrador si el problema persiste.";

export function mensajeParaInvarianteFirma(codigo: string): string {
  return MENSAJES_INVARIANTES_FIRMA[codigo] ?? MENSAJE_GENERICO_FIRMA;
}
