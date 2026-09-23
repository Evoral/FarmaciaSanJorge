"use server";

/** Server Actions for `/libro/**` (FASE 9). */
import { revalidatePath } from "next/cache";
import { anularAsiento } from "@/modules/libro/application/anular-asiento";
import { rectificarAsiento } from "@/modules/libro/application/rectificar-asiento";
import { crearAsientoHistorico } from "@/modules/libro/application/crear-asiento-historico";
import { AppError, StepUpRequiredError } from "@/shared/errors";
import type { LibroActionState } from "./action-state";

/**
 * FIX 4 (jd-fix-agent, 2026-09-23): `anularAsiento` itself now runs the
 * DT co-firma verification (own transaction, rate-limited, audits
 * failures) BEFORE doing anything else -- this Server Action only forwards
 * the raw form fields, it does NOT verify anything itself. See
 * `modules/libro/application/anular-asiento.ts`'s module doc comment for
 * why this moved out of the UI layer (an exported command that trusted a
 * pre-verified id could be called directly by ANY other caller, bypassing
 * co-firma entirely). `anularAsiento` also requires the REQUESTER's own
 * recent re-auth (INV-X02); `ReauthAwareForm` catches that and resubmits
 * automatically.
 */
export async function anularAsientoAction(_prevState: LibroActionState, formData: FormData): Promise<LibroActionState> {
  const asientoId = String(formData.get("asientoId") ?? "");
  try {
    const resultado = await anularAsiento({
      asientoId,
      motivo: String(formData.get("motivo") ?? ""),
      dtUsuarioId: String(formData.get("dtUsuarioId") ?? ""),
      dtPassword: String(formData.get("dtPassword") ?? ""),
    });
    revalidatePath(`/libro/${asientoId}`);
    revalidatePath("/libro");
    return { status: "success", message: `Asiento Nº ${resultado.numeroCorrelativo} anulado.` };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    const message = error instanceof AppError ? error.message : "No se pudo anular el asiento.";
    return { status: "error", message };
  }
}

/**
 * D1 (2026-09-23) / FIX 4 (jd-fix-agent): same shape as
 * `anularAsientoAction` above -- see that function's doc comment. Used
 * only when the target asiento's jornada is ALREADY signed (the page only
 * renders `RectificarAsientoForm` in that case -- see
 * `app/(app)/libro/[id]/page.tsx`).
 */
export async function rectificarAsientoAction(_prevState: LibroActionState, formData: FormData): Promise<LibroActionState> {
  const asientoOriginalId = String(formData.get("asientoOriginalId") ?? "");
  try {
    const resultado = await rectificarAsiento({
      asientoOriginalId,
      motivo: String(formData.get("motivo") ?? ""),
      dtUsuarioId: String(formData.get("dtUsuarioId") ?? ""),
      dtPassword: String(formData.get("dtPassword") ?? ""),
    });
    revalidatePath(`/libro/${asientoOriginalId}`);
    revalidatePath(`/libro/${resultado.id}`);
    revalidatePath("/libro");
    return { status: "success", message: `Asiento rectificativo Nº ${resultado.numeroCorrelativo} generado.` };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    const message = error instanceof AppError ? error.message : "No se pudo generar el asiento rectificativo.";
    return { status: "error", message };
  }
}

export async function crearAsientoHistoricoAction(_prevState: LibroActionState, formData: FormData): Promise<LibroActionState> {
  try {
    await crearAsientoHistorico({
      tipoLibro: String(formData.get("tipoLibro") ?? "") as "RECETARIO" | "PSICOTROPICO" | "ESTUPEFACIENTE",
      numeroAsientoFisico: String(formData.get("numeroAsientoFisico") ?? ""),
      fechaAsiento: String(formData.get("fechaAsiento") ?? ""),
      pacienteTexto: (formData.get("pacienteTexto") as string | null)?.trim() || undefined,
      medicoTexto: (formData.get("medicoTexto") as string | null)?.trim() || undefined,
      formulaTexto: String(formData.get("formulaTexto") ?? ""),
      observaciones: (formData.get("observaciones") as string | null)?.trim() || undefined,
    });
    revalidatePath("/libro/historico");
    return { status: "success", message: "Asiento histórico digitalizado." };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo digitalizar el asiento.";
    return { status: "error", message };
  }
}
