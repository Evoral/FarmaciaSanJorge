/**
 * Version-number logic for `ficha_tecnica` (M10, FASE 7 point 7.2). Pure,
 * no I/O -- `generarFichaTecnica` computes the next version from
 * `getMaxVersionFicha`'s result (0 when the item has no ficha yet, per
 * that function's own `COALESCE(MAX(version), 0)`) through THIS function,
 * so the "what's the next version" decision is unit-testable in isolation
 * from the DB round trip and the row lock that makes it safe under
 * concurrency (see modules/elaboracion/infrastructure/ficha-repository.ts's
 * module doc comment for the locking argument -- this file only covers the
 * arithmetic, not the concurrency guarantee).
 */
import { DomainError } from "@/shared/errors";

/**
 * `maxVersionActual` is `0` for an item with no ficha yet (never negative --
 * `ficha_tecnica.version` has a `CHECK (version > 0)`, migration 0012, so
 * the minimum a real MAX(version) can return is 1). Throws if a caller ever
 * passes a negative number, which would only happen from a bug upstream
 * (a malformed SQL aggregate), not from real data.
 */
export function siguienteVersionFicha(maxVersionActual: number): number {
  if (!Number.isInteger(maxVersionActual) || maxVersionActual < 0) {
    throw new DomainError(`Número de versión inválido: ${maxVersionActual}.`);
  }
  return maxVersionActual + 1;
}
