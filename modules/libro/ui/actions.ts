"use server";

/** Server Actions for `/libro/**` (FASE 9). */
import { revalidatePath } from "next/cache";
import { anularAsiento } from "@/modules/libro/application/anular-asiento";
import { rectificarAsiento } from "@/modules/libro/application/rectificar-asiento";
import { reanclarLibro } from "@/modules/libro/application/reanclar-libro";
import { invalidarResumenIntegridad } from "@/modules/libro/application/resumen-integridad";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";
import type { LibroActionState } from "./action-state";

/**
 * FIX 4 (jd-fix-agent, 2026-09-23): `anularAsiento` itself now runs the
 * DT co-firma verification (own transaction, rate-limited, audits
 * failures) BEFORE doing anything else -- this Server Action only forwards
 * the raw form fields, it does NOT verify anything itself. See
 * `modules/libro/application/anular-asiento.ts`'s module doc comment for
 * why this moved out of the UI layer (an exported command that trusted a
 * pre-verified id could be called directly by ANY other caller, bypassing
 * co-firma entirely). `anularAsiento` asks for no requester re-auth since the
 * 2026-10-21 decision; the DT's password is the only credential.
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
    return actionError(error, "No se pudo anular el asiento.");
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
    return actionError(error, "No se pudo generar el asiento rectificativo.");
  }
}

/** The DT accepts the hole in a libro's chain (migration 0087). Needs the DT's own recent re-auth; `ReauthAwareForm` resubmits after it. */
export async function reanclarLibroAction(_prevState: LibroActionState, formData: FormData): Promise<LibroActionState> {
  try {
    const resultado = await reanclarLibro({
      libroId: String(formData.get("libroId") ?? ""),
      motivo: String(formData.get("motivo") ?? ""),
    });
    invalidarResumenIntegridad();
    revalidatePath("/libro/integridad");
    return { status: "success", message: `Cadena reanclada: el asiento Nº ${resultado.numeroEsperado} queda registrado como faltante y la verificación sigue desde el Nº ${resultado.desdeNumero}.` };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    return actionError(error, "No se pudo reanclar la cadena.");
  }
}
