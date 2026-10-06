/**
 * `confirmarPreparacionDeFicha`: the toma workspace's "Continuar" dialog
 * (ui/continuar-preparacion-dialog.tsx) creates AND confirms an ítem's
 * preparación in ONE transaction -- nothing is persisted before this final
 * confirmation, so the receta never sits with a preparación INICIADA (and
 * locked for editing) that nobody confirmed.
 *
 * It is `iniciarPreparacion` followed by `confirmarPreparacion`, the very
 * same code (`iniciarPreparacionEnTx`, then `confirmarPreparacionEnTx` on
 * the new preparación): same checks (ficha found, receta not terminal,
 * INV-P02's no active preparación for the ficha), same receta moves
 * (PENDIENTE_PREPARACION -> EN_PREPARACION -> PREPARADA once every ítem is
 * CONFIRMADA) and the same egresos, libro recetario asiento and contralor.
 * The DB state machine, triggers and unique indexes see exactly what the
 * two-step flow wrote. Any failure rolls back everything (no INICIADA is
 * left behind).
 *
 * Permisos: `preparaciones.confirmar` via the pipeline (with its recent
 * re-authentication, INV-X02, same window as `confirmarPreparacion`) and
 * `preparaciones.iniciar` checked first thing in the handler. Audited once,
 * as the confirmation (CONFIRMAR), with the ficha it started from.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { authorize } from "@/shared/auth/authorize";
import { uuid } from "@/shared/validation";
import { iniciarPreparacionEnTx } from "./iniciar-preparacion";
import { confirmarPreparacionEnTx, lineaConfirmacionInput, type ConfirmarPreparacionLineaInput } from "./confirmar-preparacion";

const confirmarPreparacionDeFichaInput = z.object({
  fichaTecnicaId: uuid,
  lineas: z.array(lineaConfirmacionInput).min(1),
});

export interface ConfirmarPreparacionDeFichaInput {
  fichaTecnicaId: string;
  lineas: ConfirmarPreparacionLineaInput[];
}

export const confirmarPreparacionDeFichaCommand = defineCommand({
  name: "preparaciones.confirmarDeFicha",
  permiso: "preparaciones.confirmar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: confirmarPreparacionDeFichaInput,
  audit: { entidad: "preparacion", accion: TipoAccion.CONFIRMAR },
  handler: async ({ tx, session, input }) => {
    // The pipeline checks one permiso: starting a preparación needs its own.
    authorize(session, "preparaciones.iniciar");

    const iniciada = await iniciarPreparacionEnTx(tx, session, input.fichaTecnicaId);
    const confirmada = await confirmarPreparacionEnTx(tx, session, { preparacionId: iniciada.id, lineas: input.lineas });

    return {
      output: confirmada,
      audit: {
        entidadId: confirmada.id,
        valorNuevo: {
          fichaTecnicaId: input.fichaTecnicaId,
          fichaTecnica: iniciada.fichaTecnica,
          ...(iniciada.tomadaPor ? { tomadaPor: iniciada.tomadaPor } : {}),
          estado: "CONFIRMADA",
          asientoRecetarioId: confirmada.asientoId,
          asientoRecetario: `Nº ${confirmada.numeroCorrelativo}`,
          numeroCorrelativo: confirmada.numeroCorrelativo,
        },
      },
    };
  },
});

export async function confirmarPreparacionDeFicha(
  input: ConfirmarPreparacionDeFichaInput,
): Promise<{ id: string; asientoId: string; numeroCorrelativo: string }> {
  return confirmarPreparacionDeFichaCommand.execute(input);
}
