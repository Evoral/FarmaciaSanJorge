/**
 * Pure domain rules for the proveedor catalog (M06, FASE 4 point 4.3).
 * Migration 0007's `proveedor_cuit_formato_check` only validates SHAPE (11
 * digits, optionally hyphenated) -- the check-digit ("dígito verificador")
 * algorithm is explicitly left to application-layer validation per that
 * migration's own header comment and this task's binding decision. This
 * file implements it in pure TypeScript (no I/O) so it is testable with
 * real valid/invalid CUIT examples without a DB round trip.
 */
import { z } from "zod";
import { digitoVerificadorAfipValido } from "@/shared/validation/digito-verificador";

const CUIT_FORMATO = /^([0-9]{2})-?([0-9]{8})-?([0-9])$/;

/** Strips optional hyphens, returning the 11 raw digits, or `null` if the shape does not match `##-########-#`. */
function normalizarCuit(cuit: string): string | null {
  const match = CUIT_FORMATO.exec(cuit.trim());
  if (!match) return null;
  return `${match[1]}${match[2]}${match[3]}`;
}

/**
 * The AFIP check-digit algorithm itself lives in
 * `shared/validation/digito-verificador.ts` (FASE 4 point 4.5: CUIL, the
 * paciente identifier, uses the IDENTICAL algorithm, extracted there so
 * this file and `modules/pacientes/domain/paciente.ts` don't each carry
 * their own copy).
 */
export function cuitDigitoVerificadorValido(cuit: string): boolean {
  const digits = normalizarCuit(cuit);
  if (!digits) return false;
  return digitoVerificadorAfipValido(digits);
}

/**
 * Full CUIT validation: format (mirrors the DB CHECK) + check digit. Used by
 * both `crear-proveedor.ts` and `editar-proveedor.ts`'s zod input schemas.
 *
 * FASE 4 finding B1: the schema's OUTPUT is always normalized to the 11 raw
 * digits (`.transform(normalizarCuit)`, applied only after both refinements
 * pass, so it can never return `null`) -- callers never see a dashed value
 * out of this schema, and every INSERT/UPDATE that goes through
 * `crearProveedor`/`editarProveedor` therefore writes the SAME canonical
 * form regardless of how the user typed it ("20-12345678-6" and
 * "20123456786" both become "20123456786"). Migration 0028 normalizes
 * existing rows and tightens the DB's own format CHECK to match ("exactly
 * 11 digits") -- this transform is the reason the DB can require that
 * shape unconditionally. The UI still ACCEPTS either shape on input
 * (`CUIT_FORMATO` allows the optional dashes) and DISPLAYS the dashed form
 * (`formatCuit` below) -- normalization is a storage decision only.
 */
export const cuitString = z
  .string()
  .trim()
  .refine((value) => CUIT_FORMATO.test(value), { message: "El CUIT debe tener 11 dígitos (formato XX-XXXXXXXX-X)." })
  .refine((value) => cuitDigitoVerificadorValido(value), { message: "El CUIT no es válido: el dígito verificador no coincide." })
  .transform((value) => normalizarCuit(value) as string);

/**
 * Formats an already-normalized 11-digit CUIT (as stored in the DB since
 * migration 0028, and as returned by `cuitString`) as `XX-XXXXXXXX-X` for
 * display. Returns the input unchanged if it is not exactly 11 digits
 * (defensive -- should not happen for a DB-sourced value post-0028, but
 * this is also used for freshly-typed form input that may not have been
 * validated yet).
 */
export function formatCuit(cuit: string): string {
  const digits = cuit.trim();
  if (!/^[0-9]{11}$/.test(digits)) return cuit;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}
