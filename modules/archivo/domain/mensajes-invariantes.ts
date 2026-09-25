/**
 * Spanish messages for the `INV-XXX` codes the archivo/destrucción commands
 * (FASE 12, M15) can surface from the DB via `mapDbError` ->
 * `InvariantViolationError.invariantCode`. Same "one translation table per
 * module" discipline as `modules/cierres/domain/mensajes-invariantes.ts`.
 */
export const MENSAJES_INVARIANTES_ARCHIVO: Readonly<Record<string, string>> = {
  "INV-ARC-005": "Ese lote no puede pasar a ese estado desde su estado actual.",
  "INV-ARC-006": "Esa receta no puede archivarse: debe estar ENTREGADA o ANULADA, con la receta física recibida, y no haber sido archivada antes.",
  "INV-ARC-007": "Esa receta usa una droga controlada y no puede asignarse a un lote que no incluye controladas.",
  "INV-D02": "Para marcar un lote como DESTRUIDO hace falta el expediente y la fecha de autorización.",
  "INV-D05": "Ese lote ya fue destruido: sus datos son inmutables.",
};

const MENSAJE_GENERICO_ARCHIVO =
  "No se pudo completar la operación: se violó una regla del sistema. Contactá al administrador si el problema persiste.";

export function mensajeParaInvarianteArchivo(codigo: string): string {
  return MENSAJES_INVARIANTES_ARCHIVO[codigo] ?? MENSAJE_GENERICO_ARCHIVO;
}
