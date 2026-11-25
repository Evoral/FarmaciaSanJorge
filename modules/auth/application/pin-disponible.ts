/**
 * No two usuarios of a farmacia share a PIN (user decision 2026-10-26): the PIN identifies its owner in a cuenta de
 * sector. PINs are stored as argon2id hashes (salted), so there is no unique index: the new PIN is verified against
 * every other usuario's hash (`assertCodigoDisponible`, ./identificacion-por-codigo.ts). The error never says the PIN
 * belongs to someone; it only asks for another one. Called by `configurarPin` and `configurarPinObligatorio` before hashing.
 */
import type { Prisma } from "@/generated/prisma/client";
import { fuentePin } from "./identificador-pin";
import { assertCodigoDisponible } from "./identificacion-por-codigo";

export const MENSAJE_PIN_NO_DISPONIBLE = "Ese PIN no se puede usar. Elegí otro.";

export async function assertPinDisponible(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string, pin: string): Promise<void> {
  await assertCodigoDisponible(fuentePin, tx, tenantId, usuarioId, pin, { mensaje: MENSAJE_PIN_NO_DISPONIBLE, campo: "pin" });
}
