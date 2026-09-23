"use server";

/** Server Actions for `/preparaciones/**` (FASE 8). */
import { revalidatePath } from "next/cache";
import { iniciarPreparacion } from "@/modules/preparaciones/application/iniciar-preparacion";
import { descartarPreparacion } from "@/modules/preparaciones/application/descartar-preparacion";
import { confirmarPreparacion } from "@/modules/preparaciones/application/confirmar-preparacion";
import type { ConfirmarPreparacionLineaInput } from "@/modules/preparaciones/application/confirmar-preparacion";
import { generarEtiqueta } from "@/modules/preparaciones/application/generar-etiqueta";
import { AppError, StepUpRequiredError } from "@/shared/errors";
import type { PreparacionActionState } from "./action-state";

export async function iniciarPreparacionAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  try {
    const nueva = await iniciarPreparacion({ fichaTecnicaId: String(formData.get("fichaTecnicaId") ?? "") });
    revalidatePath("/preparaciones");
    return { status: "success", message: "Preparación iniciada.", id: nueva.id };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo iniciar la preparación.";
    return { status: "error", message };
  }
}

export async function descartarPreparacionAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  try {
    await descartarPreparacion({
      preparacionId: String(formData.get("preparacionId") ?? ""),
      motivo: String(formData.get("motivo") ?? ""),
    });
    revalidatePath("/preparaciones");
    return { status: "success", message: "Preparación descartada." };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo descartar la preparación.";
    return { status: "error", message };
  }
}

/**
 * Parses the confirm form's per-línea fields back into
 * `ConfirmarPreparacionLineaInput[]`. Field names (built by
 * `modules/preparaciones/ui/confirmar-form.tsx`):
 *   - `lineaIds` (repeated, one per línea, in ficha order)
 *   - `partida_<lineaId>` (repeated, one per CHECKED partida for that línea)
 *   - `cantidadManual_<lineaId>` (manual-enrase lines only)
 *   - `motivoApertura_<lineaId>` (optional, INV-S18)
 */
function parseLineas(formData: FormData): ConfirmarPreparacionLineaInput[] {
  const lineaIds = formData.getAll("lineaIds").map(String);
  return lineaIds.map((lineaPesajeId) => {
    const partidaIds = formData.getAll(`partida_${lineaPesajeId}`).map(String);
    const cantidadManualRaw = formData.get(`cantidadManual_${lineaPesajeId}`);
    const motivoRaw = formData.get(`motivoApertura_${lineaPesajeId}`);
    return {
      lineaPesajeId,
      partidaIds,
      cantidadManual: cantidadManualRaw ? String(cantidadManualRaw) : undefined,
      motivoAperturaAdicional: motivoRaw && String(motivoRaw).trim().length > 0 ? String(motivoRaw) : undefined,
    };
  });
}

export async function confirmarPreparacionAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  const preparacionId = String(formData.get("preparacionId") ?? "");
  try {
    const resultado = await confirmarPreparacion({ preparacionId, lineas: parseLineas(formData) });
    revalidatePath(`/preparaciones/${preparacionId}`);
    revalidatePath("/preparaciones");
    return { status: "success", message: `Preparación confirmada. Asiento libro recetario Nº ${resultado.numeroCorrelativo}.`, id: resultado.id };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    const message = error instanceof AppError ? error.message : "No se pudo confirmar la preparación.";
    return { status: "error", message };
  }
}

export async function generarEtiquetaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  const preparacionId = String(formData.get("preparacionId") ?? "");
  try {
    await generarEtiqueta({ preparacionId });
    revalidatePath(`/preparaciones/${preparacionId}`);
    return { status: "success", message: "Etiqueta generada." };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo generar la etiqueta.";
    return { status: "error", message };
  }
}
