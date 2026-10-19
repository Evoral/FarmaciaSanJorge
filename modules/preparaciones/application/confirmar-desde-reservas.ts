/**
 * Confirming a preparación from its reserva de stock (migration 0071, docs/specs/reserva-stock-preparacion.md): the
 * per-ítem work of the toma workspace's "Imprimir etiquetas" (`confirmarReservasReceta`,
 * ./confirmar-reservas-receta.ts), inside the caller's transaction, once the caller holds the locks (preparación, then
 * receta, then -- optionally -- partidas) and read the reservas: rebuild the confirmation input from the reservas (per
 * línea: the reserved partidas, the enrase manual quantity, the INV-S18 motivo) and run `confirmarPreparacionEnTx`
 * (./confirmar-preparacion.ts) with `modo: "reservada"` -- the same confirmation as always: fresh-balance revalidation
 * of the split over the RESERVED partidas (stock reserved by OTHER preparaciones is not available; the reserva is never
 * re-planned here, R5), egresos, CONFIRMADA with its vencimiento, receta PREPARADA with its last ítem, and the reservas
 * deleted. It returns the ítem's libro data: the caller writes the receta's ONE asiento with every ítem (D8,
 * `registrarAsientoRecetaEnTx`) and only then the etiquetas, which print that asiento's Nº (DP-28).
 * If the stock changed since the reserva (an ajuste, an expired partida...), the confirmation's own message explains it
 * and the caller's transaction rolls back: the reserva stays, to be recalculated ("Recalcular reserva") or released.
 *
 * Not a use case on its own: the single-ítem command (and its Server Action) was removed so no endpoint can confirm one
 * ítem out of the receta's batch (one asiento per receta, R13).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { dec } from "@/shared/decimal";
import { confirmarPreparacionEnTx, type ConfirmacionDeItem, type LineaReservada } from "./confirmar-preparacion";
import type { ReservaDePreparacion } from "../infrastructure/preparacion-repository";

/** See this file's doc comment. */
export async function confirmarDesdeReservasEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  preparacionId: string,
  reservas: readonly ReservaDePreparacion[],
): Promise<ConfirmacionDeItem> {
  return confirmarPreparacionEnTx(tx, session, { preparacionId, seleccion: { modo: "reservada", lineas: lineasDesdeReservas(reservas) } });
}

/** One línea per reserved línea: its reserved partidas plus the línea's cantidadManual/motivo (the same on each of its rows). */
export function lineasDesdeReservas(reservas: readonly ReservaDePreparacion[]): LineaReservada[] {
  const porLinea = new Map<string, LineaReservada>();
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
      cantidadReal: reserva.cantidadReal ? dec(reserva.cantidadReal) : undefined,
      pesadaAutorizadaPorId: reserva.pesadaAutorizadaPorId ?? undefined,
    });
  }
  return [...porLinea.values()];
}
