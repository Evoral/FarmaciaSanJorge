/**
 * The Argentine DNI as every module stores and compares it: digits only, so
 * "12.345.678", "12 345 678" and "12345678" are the same person (and collide
 * on the uniqueness checks). Historical DNIs have 7 digits, current ones 8.
 * No check-digit algorithm exists for DNI (it is not an AFIP identifier).
 */

/** Strips every non-digit character (dots, spaces, dashes). */
export function normalizarDni(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** Whether an already-normalized DNI has a valid shape (migration 0029's `paciente_dni_formato_check`). */
export function dniValido(digits: string): boolean {
  return /^[0-9]{7,8}$/.test(digits);
}

export const MENSAJE_DNI_INVALIDO = "El DNI debe tener 7 u 8 dígitos.";
