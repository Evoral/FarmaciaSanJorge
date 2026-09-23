/**
 * AFIP modulo-11 check digit ("dígito verificador") algorithm. CUIT
 * (proveedor, migration 0007) and CUIL (paciente, migration 0007) are BOTH
 * 11-digit AFIP tax identifiers that use the exact same algorithm -- only
 * the entity attached to the number differs. Extracted here (FASE 4 point
 * 4.5, per the task's binding instruction: "reuse, don't duplicate") so
 * `modules/proveedores/domain/proveedor.ts` and
 * `modules/pacientes/domain/paciente.ts` share one implementation instead of
 * two copies that could silently drift.
 *
 * Multiply the first 10 digits by the fixed sequence
 * [5,4,3,2,7,6,5,4,3,2], sum, take mod 11, and the verifier is
 * `11 - (sum mod 11)`, wrapping 11 -> 0. A result of 10 has no valid digit
 * (no real CUIT/CUIL can ever produce it) -- such a value is rejected as
 * invalid.
 */
const MULTIPLICADORES = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * `true` when `digits11` (EXACTLY 11 digits, no separators -- callers
 * normalize/shape-validate before calling this) has a valid AFIP check
 * digit as its 11th character. Returns `false` for anything that is not
 * exactly 11 digits, so callers may call this directly on unsanitized
 * input if they want a single boolean answer.
 */
export function digitoVerificadorAfipValido(digits11: string): boolean {
  if (!/^[0-9]{11}$/.test(digits11)) return false;

  const primeros10 = digits11.slice(0, 10);
  const verificadorActual = Number(digits11[10]);

  const suma = primeros10.split("").reduce((acc, digit, index) => acc + Number(digit) * MULTIPLICADORES[index], 0);
  const resto = suma % 11;
  let verificadorEsperado = 11 - resto;
  if (verificadorEsperado === 11) verificadorEsperado = 0;
  if (verificadorEsperado === 10) return false;

  return verificadorEsperado === verificadorActual;
}
