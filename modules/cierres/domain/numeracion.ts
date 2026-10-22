/**
 * Migration 0097 (INV-L26): the first signed cierre covering a libro fixes its first number for good, so the DT
 * confirms, on the firma form, the number each of those libros starts at. Pure check of that confirmation against
 * the libros the cierre will actually fix.
 */

export interface NumeracionLibro {
  libroId: string;
  numeroInicial: string;
}

export type ResultadoConfirmacionNumeracion = { ok: true } | { ok: false; error: string };

export function validarConfirmacionNumeracion(porFijar: readonly NumeracionLibro[], confirmada: readonly NumeracionLibro[]): ResultadoConfirmacionNumeracion {
  if (porFijar.length === 0) return { ok: true };
  if (confirmada.length === 0) {
    return { ok: false, error: "Este cierre deja fija la numeración del libro: confirmá el número del primer asiento antes de firmar." };
  }
  const coincide =
    porFijar.length === confirmada.length && porFijar.every((l) => confirmada.some((c) => c.libroId === l.libroId && c.numeroInicial === l.numeroInicial));
  return coincide ? { ok: true } : { ok: false, error: "La numeración del libro cambió desde que abriste esta pantalla. Revisala y volvé a confirmar." };
}
