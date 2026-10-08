/**
 * `confirmarReservaStock`: the toma workspace's "Imprimir etiqueta" on an
 * ítem whose stock is reserved (migration 0071,
 * docs/specs/reserva-stock-preparacion.md) -- the end of the lab's process
 * and the ONLY point where it becomes fixed. ONE transaction:
 *   1. Lock the preparación (then its receta, before any partida) and read
 *      its reservas (none -> clear error).
 *   2. Rebuild the confirmation input from them (per línea: the chosen
 *      partidas, the enrase manual quantity, the INV-S18 motivo) and run
 *      `confirmarPreparacionEnTx` (./confirmar-preparacion.ts) -- the same
 *      confirmation as always: fresh-balance revalidation of the split
 *      (stock reserved by OTHER preparaciones is not available), egresos,
 *      asiento_recetario, asiento_contralor, CONFIRMADA with its vencimiento,
 *      receta PREPARADA with its last ítem, and the reservas deleted.
 *   3. Generate the etiqueta (`generarEtiquetaEnTx`, ./generar-etiqueta.ts),
 *      which prints the asiento Nº (DP-28).
 * If the stock changed since the reserva (an ajuste, an expired partida...),
 * the confirmation's own message explains it and NOTHING persists: the
 * reserva stays, to be released and done again. The client then opens the
 * existing print flow (size dialog -> PDF route, ui/imprimir-etiqueta-dialog.tsx).
 *
 * Permisos: `preparaciones.confirmar` via the pipeline (recent
 * re-authentication, INV-X02, same window as `confirmarPreparacion`) and
 * `etiquetas.generar` checked first thing in the handler. Audited once, as
 * the confirmation (CONFIRMAR), with the etiqueta it generated.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { authorize } from "@/shared/auth/authorize";
import { DomainError, NotFoundError } from "@/shared/errors";
import { dec } from "@/shared/decimal";
import { uuid } from "@/shared/validation";
import { confirmarPreparacionEnTx, type ConfirmacionResultado, type LineaConfirmacion } from "./confirmar-preparacion";
import { generarEtiquetaEnTx } from "./generar-etiqueta";
import {
  getPreparacionParaAccion,
  getRecetaContextoAsiento,
  listReservasDePreparacion,
  lockPreparacionParaAccion,
  lockRecetaParaTransicion,
  type ReservaDePreparacion,
} from "../infrastructure/preparacion-repository";

const confirmarReservaStockInput = z.object({ preparacionId: uuid });

export const confirmarReservaStockCommand = defineCommand({
  name: "preparaciones.confirmarReserva",
  permiso: "preparaciones.confirmar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: confirmarReservaStockInput,
  audit: { entidad: "preparacion", accion: TipoAccion.CONFIRMAR },
  handler: async ({ tx, session, input }) => {
    // The pipeline checks one permiso: the etiqueta needs its own.
    authorize(session, "etiquetas.generar");

    // Read the reserva under the preparación's lock (confirmarPreparacionEnTx re-locks it, same transaction). The
    // receta is locked BEFORE the partidas, the same order as reservarStockPreparacion (receta, then partidas): a
    // reserva on another ítem of the same receta can not deadlock with this confirmation.
    if (!(await lockPreparacionParaAccion(tx, session.tenantId, input.preparacionId))) {
      throw new NotFoundError("Preparación no encontrada.");
    }
    const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    const contexto = preparacion ? await getRecetaContextoAsiento(tx, session.tenantId, preparacion.itemRecetaId) : null;
    if (contexto) await lockRecetaParaTransicion(tx, session.tenantId, contexto.recetaId);
    const reservas = await listReservasDePreparacion(tx, session.tenantId, input.preparacionId);
    if (reservas.length === 0) {
      throw new DomainError("Esta preparación no tiene stock reservado: reservá el stock antes de imprimir la etiqueta.");
    }

    const confirmada = await confirmarPreparacionEnTx(tx, session, { preparacionId: input.preparacionId, lineas: lineasDesdeReservas(reservas) });
    const etiqueta = await generarEtiquetaEnTx(tx, session.tenantId, input.preparacionId);

    return {
      output: { ...confirmada, etiquetaId: etiqueta.id },
      audit: {
        entidadId: confirmada.id,
        valorNuevo: {
          estado: "CONFIRMADA",
          desdeReservaStock: true,
          asientoRecetarioId: confirmada.asientoId,
          asientoRecetario: `Nº ${confirmada.numeroCorrelativo}`,
          numeroCorrelativo: confirmada.numeroCorrelativo,
          fechaVencimiento: confirmada.fechaVencimiento,
          etiquetaId: etiqueta.id,
        },
      },
    };
  },
});

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

export async function confirmarReservaStock(preparacionId: string): Promise<ConfirmacionResultado & { etiquetaId: string }> {
  return confirmarReservaStockCommand.execute({ preparacionId });
}
