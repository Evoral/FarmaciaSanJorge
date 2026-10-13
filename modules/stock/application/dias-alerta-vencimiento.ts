/**
 * The tenant's `dias_alerta_vencimiento_partida` (DP-14, default 30) inside the
 * caller's transaction, for other modules that show a partida as "por vencer"
 * (docs/specs/reanalisis-partida.md): the preparaciones flow reads it through
 * here instead of reaching into this module's infrastructure. Same value the
 * stock alerts use (`alertasStock`).
 */
import type { Prisma } from "@/generated/prisma/client";
import { getDiasAlertaVencimiento } from "../infrastructure/partida-repository";

export async function diasAlertaVencimientoEnTx(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  return getDiasAlertaVencimiento(tx, tenantId);
}
