/**
 * Pure domain rules for the paciente catalog (M06, FASE 4 point 4.5).
 * HEALTH-ADJACENT DATA (Ley 25.326, DP-24 unresolved) -- see this module's
 * `application/*` and `ui/*` files for the minimum-safe-policy handling
 * (permiso-gated access, no logging, no URL/query-string exposure).
 *
 * Migration 0029's `paciente_cuil_formato_check` / `paciente_dni_formato_check`
 * only validate SHAPE (11 digits / 7-8 digits respectively) -- the CUIL
 * check-digit algorithm is application-layer, same division of labor as
 * proveedor.cuit (migration 0007's own header comment). CUIL uses the
 * IDENTICAL AFIP algorithm as CUIT (both are 11-digit Argentine tax ids) --
 * `shared/validation/digito-verificador.ts` is the single shared
 * implementation, reused here instead of duplicating
 * `modules/proveedores/domain/proveedor.ts`'s copy.
 */
import { z } from "zod";
import { digitoVerificadorAfipValido } from "@/shared/validation/digito-verificador";

/** Strips every non-digit character (spaces, dashes, dots). */
function soloDigitos(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/**
 * Optional CUIL: `undefined`/empty input -> `null` (cuil stays optional,
 * per migration 0007/plan §9 M06). Non-empty input must normalize to
 * exactly 11 digits AND carry a valid AFIP check digit -- both refinements
 * mirror `modules/proveedores/domain/proveedor.ts`'s `cuitString`, applied
 * to the optional case.
 */
export const cuilOpcional = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value || value.length === 0) return null;
    const digits = soloDigitos(value);
    if (!/^[0-9]{11}$/.test(digits)) {
      ctx.addIssue({ code: "custom", message: "El CUIL debe tener 11 dígitos." });
      return z.NEVER;
    }
    if (!digitoVerificadorAfipValido(digits)) {
      ctx.addIssue({ code: "custom", message: "El CUIL no es válido: el dígito verificador no coincide." });
      return z.NEVER;
    }
    return digits;
  });

/**
 * Optional DNI: `undefined`/empty input -> `null`. Non-empty input must
 * normalize (strip dots/spaces) to exactly 7 or 8 digits -- historical
 * DNIs can be 7 digits, current ones are 8. No check-digit algorithm
 * exists for DNI (it is not an AFIP identifier).
 */
export const dniOpcional = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value || value.length === 0) return null;
    const digits = soloDigitos(value);
    if (!/^[0-9]{7,8}$/.test(digits)) {
      ctx.addIssue({ code: "custom", message: "El DNI debe tener 7 u 8 dígitos." });
      return z.NEVER;
    }
    return digits;
  });

export { soloDigitos };
