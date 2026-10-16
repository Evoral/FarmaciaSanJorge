/**
 * `reservarStockPreparacion`: the toma workspace's "Marcar como preparada" (one click, or the dialog of
 * ui/continuar-preparacion-dialog.tsx when an enrase manual quantity must be typed) creates an ítem's preparación
 * (INICIADA) and RESERVES the stock it will use, in ONE transaction (migration 0071,
 * docs/specs/reserva-stock-preparacion.md). The lab still has internal steps after weighing, so nothing is fixed yet:
 * no movimiento_stock, no libro recetario asiento, no contralor. That happens at the receta's "Imprimir etiquetas"
 * (`confirmarReservasReceta`, ./confirmar-reservas-receta.ts), or the reserva is released ("Liberar reserva",
 * ./liberar-reserva-stock.ts).
 *
 * It is `iniciarPreparacion` (`iniciarPreparacionEnTx`: receta locked and re-checked, ítem locked, ficha vigente --
 * latest version, built from the ítem's current data --, no other live preparación of the ítem; the receta keeps its
 * estado but is not editable while the preparación lives) followed by the AUTOMATIC plan (R1, DT decision 2026-10-15:
 * `planificarConsumoEnTx` with `modo: "automatica"`, ./confirmar-preparacion.ts): every eligible partida of each
 * línea's droga, locked in id order and re-read, split abiertas first then FEFO, validated exactly as its confirmation
 * will be against stock NOT reserved by other preparaciones. The client never sends partidas: only the enrase manual
 * quantity and, when INV-S18 asks for it, the motivo. Then one `reserva_stock` row per partida the split draws from
 * (R2), plus the línea's cantidadManual and motivo, so the confirmation can rebuild the same input. Any failure rolls
 * back everything (no INICIADA is left behind).
 *
 * Lock order (R23): ficha (advisory) -> receta -> item_receta -> partidas.
 *
 * Permisos: `preparaciones.confirmar` via the pipeline (with its recent re-authentication, INV-X02, same window as
 * the confirmation) and `preparaciones.iniciar` checked first thing in the handler. Audited once (CREAR on the
 * preparación), with the ficha it started from and the reserva.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { authorize } from "@/shared/auth/authorize";
import { uuid } from "@/shared/validation";
import { iniciarPreparacionEnTx } from "./iniciar-preparacion";
import { comoErrorDeDominio, lineaEntradaInput, planificarConsumoEnTx, type LineaEntradaInput, type LineaPlanificada } from "./confirmar-preparacion";
import { insertReservas, jornadaActualTenant, type ReservaDePreparacion } from "../infrastructure/preparacion-repository";

const reservarStockPreparacionInput = z.object({
  fichaTecnicaId: uuid,
  /** Only the líneas with something typed (enrase manual quantity, INV-S18 motivo); the partidas are the system's. */
  lineas: z.array(lineaEntradaInput).default([]),
});

export interface ReservarStockPreparacionInput {
  fichaTecnicaId: string;
  lineas?: LineaEntradaInput[];
}

export const reservarStockPreparacionCommand = defineCommand({
  name: "preparaciones.reservarStock",
  permiso: "preparaciones.confirmar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: reservarStockPreparacionInput,
  audit: { entidad: "preparacion", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    // The pipeline checks one permiso: starting a preparación needs its own.
    authorize(session, "preparaciones.iniciar");

    try {
      const iniciada = await iniciarPreparacionEnTx(tx, session, input.fichaTecnicaId);
      const jornada = await jornadaActualTenant(tx, session.tenantId);
      const plan = await planificarConsumoEnTx(tx, session.tenantId, {
        preparacionId: iniciada.id,
        fichaTecnicaId: input.fichaTecnicaId,
        seleccion: { modo: "automatica", entradas: input.lineas },
        jornada,
      });

      await insertReservas(tx, { tenantId: session.tenantId, preparacionId: iniciada.id, reservadaPorId: session.usuario.id, reservas: reservasDelPlan(plan) });

      return {
        output: { id: iniciada.id },
        audit: {
          entidadId: iniciada.id,
          valorNuevo: {
            fichaTecnicaId: input.fichaTecnicaId,
            fichaTecnica: iniciada.fichaTecnica,
            ...(iniciada.tomadaPor ? { tomadaPor: iniciada.tomadaPor } : {}),
            estado: "INICIADA",
            reservaStock: resumenDelPlan(plan),
          },
        },
      };
    } catch (e) {
      throw comoErrorDeDominio(e);
    }
  },
});

/**
 * The `reserva_stock` rows of a validated plan (R2): one per partida the línea draws from -- for the automatic plan,
 * exactly the split's partidas, all with cantidad > 0 -- with what the split takes from it in the droga's unidad base,
 * and the línea's typed cantidadManual as typed (línea unit) and motivo. Also used by `recalcularReservaStock` and
 * `registrarPerdidaReserva`.
 */
export function reservasDelPlan(plan: readonly LineaPlanificada[]): ReservaDePreparacion[] {
  return plan.flatMap(({ linea, elegido, split }) =>
    elegido.partidaIds.map((partidaId) => ({
      lineaPesajeId: linea.id,
      partidaId,
      cantidad: (split.find((parte) => parte.partidaId === partidaId)?.cantidad ?? 0).toString(),
      cantidadManual: linea.esEnraseManual && elegido.cantidadManual ? elegido.cantidadManual.toString() : null,
      motivoAperturaAdicional: elegido.motivoAperturaAdicional ?? null,
    })),
  );
}

/** What the audit records of a reserva: droga, lote and quantity of every partida the split draws from (a stock quantity: the droga's unidad base). */
export function resumenDelPlan(plan: readonly LineaPlanificada[]): { droga: string; lote: string; cantidad: string }[] {
  return plan.flatMap(({ linea, split, partidas }) =>
    split.map((parte) => ({
      droga: linea.drogaNombre,
      lote: partidas.find((p) => p.id === parte.partidaId)?.lote ?? parte.partidaId,
      cantidad: `${parte.cantidad.toString()} ${linea.unidadStock.simbolo}`,
    })),
  );
}

export async function reservarStockPreparacion(input: ReservarStockPreparacionInput): Promise<{ id: string }> {
  return reservarStockPreparacionCommand.execute(input);
}
