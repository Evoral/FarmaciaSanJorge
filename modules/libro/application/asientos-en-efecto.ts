/**
 * Entry point for other modules' application layer to D2's "asiento still
 * in effect" (docs/specs/libro-recetario-y-contralor.md §1): the receta's
 * SISTEMA asientos that are neither ANULADO nor rectified. Used by
 * `recetas.anular` (to refuse a direct anulación the libro would
 * contradict) and the receta detail. Not a use case: callers run it inside
 * their own transaction.
 */
import type { Prisma } from "@/generated/prisma/client";
import { asientosEnEfectoDeReceta } from "../infrastructure/receta-coupling-repository";
import type { AsientoEnEfecto } from "../infrastructure/receta-coupling-repository";

export type { AsientoEnEfecto };

export async function listAsientosEnEfectoDeReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<AsientoEnEfecto[]> {
  return asientosEnEfectoDeReceta(tx, tenantId, recetaId);
}
