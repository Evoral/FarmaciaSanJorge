/**
 * `reservarStockPreparacion`: the toma workspace's "Marcar como preparada" (one click, or the dialog of
 * ui/continuar-preparacion-dialog.tsx when an enrase manual quantity must be typed) creates an ítem's preparación
 * (INICIADA) and RESERVES the stock it will use, in ONE transaction (migration 0071,
 * openspec/specs/reserva-stock-preparacion/spec.md). The lab still has internal steps after weighing, so nothing is fixed yet:
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
 * Permisos: `preparaciones.confirmar` via the pipeline (no re-authentication since the 2026-10-21 decision) and `preparaciones.iniciar` checked first thing in the handler. Audited once (CREAR on the
 * preparación), with the ficha it started from and the reserva.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { authorize } from "@/shared/auth/authorize";
import { decimalString, uuid } from "@/shared/validation";
import { iniciarPreparacionEnTx } from "./iniciar-preparacion";
import {
  comoErrorDeDominio,
  lineaEntradaInput,
  pesadaAutorizadaPorIdInput,
  planificarConsumoEnTx,
  type CoFirmaPesadaInput,
  type LineaEntradaInput,
  type LineaPlanificada,
} from "./confirmar-preparacion";
import { autorizacionDePesadaReal } from "./co-firma-pesada-real";
import { partidasCandidatasExcipienteEnTx, reservarExcipienteEnTx } from "./excipiente-preparacion";
import { partidasCandidatasInsumosEnTx, reservarInsumosEnTx } from "./insumos-preparacion";
import { INSUMOS_MAX } from "./guardar-insumos-borrador";
import { TIPOS_INSUMO, type TipoInsumo } from "../domain/insumo";
import { insertReservas, jornadaActualTenant, type ReservaDePreparacion } from "../infrastructure/preparacion-repository";

const reservarStockPreparacionInput = z.object({
  fichaTecnicaId: uuid,
  /** Only the líneas with something typed (enrase manual quantity, INV-S18 motivo); the partidas are the system's. */
  lineas: z.array(lineaEntradaInput).default([]),
  pesadaAutorizadaPorId: pesadaAutorizadaPorIdInput,
  /** The excipiente used (migration 0092): a droga of clase EXCIPIENTE and its quantity in the droga's unidad base; reserved oldest lot first. */
  excipiente: z.object({ drogaId: uuid, cantidad: decimalString }).optional(),
  /** The material and insumos adicionales (migration 0110): only the ones with a droga chosen; reserved oldest lot first. */
  insumos: z.array(z.object({ tipo: z.enum(TIPOS_INSUMO), drogaId: uuid, cantidad: decimalString })).max(INSUMOS_MAX).default([]),
});

export interface ReservarStockPreparacionInput extends CoFirmaPesadaInput {
  fichaTecnicaId: string;
  lineas?: LineaEntradaInput[];
  excipiente?: { drogaId: string; cantidad: string };
  insumos?: { tipo: TipoInsumo; drogaId: string; cantidad: string }[];
}

export const reservarStockPreparacionCommand = defineCommand({
  name: "preparaciones.reservarStock",
  permiso: "preparaciones.confirmar",
  input: reservarStockPreparacionInput,
  audit: { entidad: "preparacion", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    // The pipeline checks one permiso: starting a preparación needs its own.
    authorize(session, "preparaciones.iniciar");

    try {
      const iniciada = await iniciarPreparacionEnTx(tx, session, input.fichaTecnicaId);
      const jornada = await jornadaActualTenant(tx, session.tenantId);
      const partidasExcipiente = input.excipiente
        ? await partidasCandidatasExcipienteEnTx(tx, session.tenantId, { preparacionId: iniciada.id, drogaId: input.excipiente.drogaId })
        : [];
      const partidasInsumos = await partidasCandidatasInsumosEnTx(tx, session.tenantId, { preparacionId: iniciada.id, drogaIds: input.insumos.map((i) => i.drogaId) });
      const plan = await planificarConsumoEnTx(tx, session.tenantId, {
        partidasAdicionales: [...partidasExcipiente, ...partidasInsumos],
        preparacionId: iniciada.id,
        fichaTecnicaId: input.fichaTecnicaId,
        seleccion: { modo: "automatica", entradas: input.lineas, pesadaAutorizadaPorId: input.pesadaAutorizadaPorId },
        jornada,
      });

      await insertReservas(tx, { tenantId: session.tenantId, preparacionId: iniciada.id, reservadaPorId: session.usuario.id, reservas: reservasDelPlan(plan) });
      const excipiente = await reservarExcipienteEnTx(tx, session, { preparacionId: iniciada.id, excipiente: input.excipiente ?? null, jornada });
      const insumos = await reservarInsumosEnTx(tx, session, { preparacionId: iniciada.id, insumos: input.insumos, jornada });

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
            ...pesadasDelPlan(plan),
            ...(excipiente ? { excipiente } : {}),
            ...(insumos.length > 0 ? { insumos } : {}),
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
      cantidadReal: !linea.esEnraseManual && elegido.cantidadReal ? elegido.cantidadReal.toString() : null,
      pesadaAutorizadaPorId: elegido.pesadaAutorizadaPorId ?? null,
    })),
  );
}

/**
 * What the audit records of the pesadas reales (openspec/specs/pesada-real/spec.md): per línea weighed for real, the expected
 * and real weight (línea unit) and, outside the tolerance, the DT who co-signed. Omitted when there is none.
 */
export function pesadasDelPlan(plan: readonly LineaPlanificada[]): { pesadasReales?: { droga: string; esperada: string; real: string; autorizadoPorId: string | null }[] } {
  const pesadas = plan.flatMap(({ linea, pesada }) =>
    pesada
      ? [{ droga: linea.drogaNombre, esperada: `${pesada.esperada.toString()} ${linea.unidadSimbolo}`, real: `${pesada.real.toString()} ${linea.unidadSimbolo}`, autorizadoPorId: pesada.autorizadoPorId }]
      : [],
  );
  return pesadas.length > 0 ? { pesadasReales: pesadas } : {};
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
  const { dtUsuarioId, dtPassword, ...resto } = input;
  const pesadaAutorizadaPorId = await autorizacionDePesadaReal({ dtUsuarioId, dtPassword });
  return reservarStockPreparacionCommand.execute({ ...resto, pesadaAutorizadaPorId });
}
