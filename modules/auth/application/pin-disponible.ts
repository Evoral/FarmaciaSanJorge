/**
 * No two usuarios of a farmacia share a PIN (user decision 2026-10-26): the PIN identifies its owner in a cuenta de
 * sector. PINs are stored as argon2id hashes (salted), so there is no unique index: the new PIN is verified against
 * every other usuario's hash (in parallel -- a farmacia has few usuarios). The error never says the PIN belongs to
 * someone; it only asks for another one. Called by `configurarPin` and `configurarPinObligatorio` before hashing.
 */
import type { Prisma } from "@/generated/prisma/client";
import { ValidationError } from "@/shared/errors";
import { verifyPassword } from "../domain/password";
import { loadPinHashesDeOtros } from "../infrastructure/usuario-repository";

export const MENSAJE_PIN_NO_DISPONIBLE = "Ese PIN no se puede usar. Elegí otro.";

export async function assertPinDisponible(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string, pin: string): Promise<void> {
  const hashes = await loadPinHashesDeOtros(tx, tenantId, usuarioId);
  const coincidencias = await Promise.all(hashes.map((hash) => verifyPassword(hash, pin)));
  if (coincidencias.some(Boolean)) {
    throw new ValidationError(MENSAJE_PIN_NO_DISPONIBLE, { fields: ["pin"] });
  }
}
