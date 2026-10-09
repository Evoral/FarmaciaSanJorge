/**
 * `reservarStockPreparacion`: the toma workspace's "Continuar" dialog
 * (ui/continuar-preparacion-dialog.tsx) creates an ítem's preparación
 * (INICIADA) and RESERVES the stock it will use, in ONE transaction
 * (migration 0071, docs/specs/reserva-stock-preparacion.md). The lab still
 * has internal steps after weighing, so nothing is fixed yet: no
 * movimiento_stock, no libro recetario asiento, no contralor. That happens at
 * "Imprimir etiqueta" (`confirmarReservaStock`, ./confirmar-reserva-stock.ts),
 * or the reserva is released ("Liberar reserva", ./liberar-reserva-stock.ts).
 *
 * It is `iniciarPreparacion` (`iniciarPreparacionEnTx`: ficha found, receta
 * not terminal, INV-P02; the receta keeps its estado -- it moves to
 * EN_PREPARACION only at the first confirmation -- but a LIVE preparación
 * blocks editing it until the reserva is released) followed by the confirmation's own checks
 * (`planificarConsumoEnTx`, ./confirmar-preparacion.ts: líneas match the
 * ficha, chosen partidas locked in id order and re-read, split recomputed
 * by the system, expiry, stock, INV-S15 desvío, INV-S18 motivo) -- the
 * reserva is validated exactly as its confirmation will be, against stock
 * NOT reserved by other preparaciones. Then one `reserva_stock` row per
 * chosen partida of each línea, with what the split takes from it (0 when
 * the split does not need it), plus the línea's cantidadManual and motivo,
 * so the confirmation can rebuild the same input. Any failure rolls back
 * everything (no INICIADA is left behind).
 *
 * Permisos: `preparaciones.confirmar` via the pipeline (with its recent
 * re-authentication, INV-X02, same window as the confirmation) and
 * `preparaciones.iniciar` checked first thing in the handler. Audited once
 * (CREAR on the preparación), with the ficha it started from and the
 * reserva.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { authorize } from "@/shared/auth/authorize";
import { uuid } from "@/shared/validation";
import { iniciarPreparacionEnTx } from "./iniciar-preparacion";
import {
  comoErrorDeDominio,
  lineaConfirmacionInput,
  planificarConsumoEnTx,
  type ConfirmarPreparacionLineaInput,
  type LineaPlanificada,
} from "./confirmar-preparacion";
import { insertReservas, jornadaActualTenant, type ReservaDePreparacion } from "../infrastructure/preparacion-repository";

const reservarStockPreparacionInput = z.object({
  fichaTecnicaId: uuid,
  lineas: z.array(lineaConfirmacionInput).min(1),
});

export interface ReservarStockPreparacionInput {
  fichaTecnicaId: string;
  lineas: ConfirmarPreparacionLineaInput[];
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
        lineas: input.lineas,
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
 * The `reserva_stock` rows of a validated plan: every CHOSEN partida keeps a row (the confirmation re-validates the same
 * choice), with what the split takes from it (0 when the split does not need it) in the droga's unidad base, and the
 * línea's typed cantidadManual as typed (línea unit). Also used by `modificarReservaStock`.
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
