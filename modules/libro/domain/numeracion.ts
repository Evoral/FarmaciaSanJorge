/**
 * Initial numbering of a libro (migration 0097, INV-L26, docs/specs/libro-recetario-y-contralor.md "Numeración
 * inicial"). A libro starts at 1 or continues the physical book; the first number can change until the first signed
 * cierre covering its asientos. Changing it shifts every existing asiento by the difference. Numbers are decimal
 * strings (bigint columns), compared and shifted with BigInt.
 */

/** Upper bound for the first number: far above any physical book, and safely inside a bigint. */
export const NUMERO_INICIAL_MAXIMO = BigInt(999_999_999);

/** The first number typed by the DT, or null when it is not a whole number between 1 and the maximum. */
export function parseNumeroInicial(raw: string): bigint | null {
  const texto = raw.trim();
  if (!/^\d{1,12}$/.test(texto)) return null;
  const numero = BigInt(texto);
  return numero >= BigInt(1) && numero <= NUMERO_INICIAL_MAXIMO ? numero : null;
}

/** Where the existing asientos `primero`..`ultimo` land when the first number changes from `actual` to `nuevo`. */
export function rangoRenumerado(input: { actual: string; nuevo: bigint; primero: string; ultimo: string }): { desde: string; hasta: string } {
  const delta = input.nuevo - BigInt(input.actual);
  return { desde: (BigInt(input.primero) + delta).toString(), hasta: (BigInt(input.ultimo) + delta).toString() };
}
