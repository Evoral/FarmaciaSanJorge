/**
 * Confirming a preparación from its reserva de stock (migration 0071, docs/specs/reserva-stock-preparacion.md): the
 * per-ítem work of the toma workspace's "Imprimir etiquetas" (`confirmarReservasReceta`,
 * ./confirmar-reservas-receta.ts), inside the caller's transaction, once the caller holds the locks (preparación, then
 * receta, then -- optionally -- partidas) and read the reservas:
 *   1. Rebuild the confirmation input from the reservas (per línea: the chosen partidas, the enrase manual quantity, the
 *      INV-S18 motivo) and run `confirmarPreparacionEnTx` (./confirmar-preparacion.ts) -- the same confirmation as
 *      always: fresh-balance revalidation of the split (stock reserved by OTHER preparaciones is not available),
 *      egresos, asiento_recetario, asiento_contralor, CONFIRMADA with its vencimiento, receta PREPARADA with its last
 *      ítem, and the reservas deleted.
 *   2. Generate the etiqueta (`generarEtiquetaEnTx`, ./generar-etiqueta.ts), which prints the asiento Nº (DP-28).
 * If the stock changed since the reserva (an ajuste, an expired partida...), the confirmation's own message explains it
 * and the caller's transaction rolls back: the reserva stays, to be modified or released.
 *
 * Not a use case on its own: the single-ítem command (and its Server Action) was removed so no endpoint can confirm one
 * ítem out of the receta's batch (consecutive asientos, R13).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { dec } from "@/shared/decimal";
import { confirmarPreparacionEnTx, type ConfirmacionResultado, type LineaConfirmacion } from "./confirmar-preparacion";
import { generarEtiquetaEnTx } from "./generar-etiqueta";
import type { ReservaDePreparacion } from "../infrastructure/preparacion-repository";

/** Steps 1-2 of this file's doc comment. */
export async function confirmarDesdeReservasEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  preparacionId: string,
  reservas: readonly ReservaDePreparacion[],
): Promise<ConfirmacionResultado & { etiquetaId: string }> {
  const confirmada = await confirmarPreparacionEnTx(tx, session, { preparacionId, lineas: lineasDesdeReservas(reservas) });
  const etiqueta = await generarEtiquetaEnTx(tx, session.tenantId, preparacionId);
  return { ...confirmada, etiquetaId: etiqueta.id };
}

/** One confirmation línea per reserved línea: its chosen partidas plus the línea's cantidadManual/motivo (the same on each of its rows). */
export function lineasDesdeReservas(reservas: readonly ReservaDePreparacion[]): LineaConfirmacion[] {
  const porLinea = new Map<string, LineaConfirmacion>();
  for (const reserva of reservas) {
    const linea = porLinea.get(reserva.lineaPesajeId);
    if (linea) {
      linea.partidaIds.push(reserva.partidaId);
      continue;
    }
    porLinea.set(reserva.lineaPesajeId, {
      lineaPesajeId: reserva.lineaPesajeId,
      partidaIds: [reserva.partidaId],
      cantidadManual: reserva.cantidadManual ? dec(reserva.cantidadManual) : undefined,
      motivoAperturaAdicional: reserva.motivoAperturaAdicional ?? undefined,
    });
  }
  return [...porLinea.values()];
}
