"use server";

/** Server Actions for `/preparaciones/**` (FASE 8). */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hrefToma } from "@/modules/preparaciones/domain/toma";
import { iniciarPreparacion } from "@/modules/preparaciones/application/iniciar-preparacion";
import { tomarReceta } from "@/modules/preparaciones/application/tomar-receta";
import { cancelarToma } from "@/modules/preparaciones/application/cancelar-toma";
import { descartarPreparacion } from "@/modules/preparaciones/application/descartar-preparacion";
import { confirmarPreparacion } from "@/modules/preparaciones/application/confirmar-preparacion";
import type { ConfirmarPreparacionLineaInput } from "@/modules/preparaciones/application/confirmar-preparacion";
import { reservarStockPreparacion } from "@/modules/preparaciones/application/reservar-stock-preparacion";
import { liberarReservaStock } from "@/modules/preparaciones/application/liberar-reserva-stock";
import { confirmarReservaStock } from "@/modules/preparaciones/application/confirmar-reserva-stock";
import { modificarReservaStock } from "@/modules/preparaciones/application/modificar-reserva-stock";
import { getModificacionDeReserva } from "@/modules/preparaciones/application/get-modificacion-de-reserva";
import { registrarPerdidaReserva, type RegistrarPerdidaReservaInput } from "@/modules/preparaciones/application/registrar-perdida-reserva";
import { getConfirmacionDeFicha } from "@/modules/preparaciones/application/get-confirmacion-de-ficha";
import { generarEtiqueta } from "@/modules/preparaciones/application/generar-etiqueta";
import { previsualizarFichas } from "@/modules/preparaciones/application/previsualizar-fichas";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError, actionErrorMessage } from "@/shared/ui/action-error";
import type { ConfirmacionDeFichaState, PreparacionActionState, VistaPreviaFichasState } from "./action-state";

export async function iniciarPreparacionAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  try {
    const nueva = await iniciarPreparacion({ fichaTecnicaId: String(formData.get("fichaTecnicaId") ?? "") });
    revalidatePath("/preparaciones");
    // The receta (possibly taken now) is no longer editable while the preparación lives.
    revalidatePath("/recetas");
    return { status: "success", message: "Preparación iniciada.", id: nueva.id };
  } catch (error) {
    return actionError(error, "No se pudo iniciar la preparación.");
  }
}

/**
 * Live preview of the fichas técnicas of a receta's unsaved ítems (the toma workspace's edit form):
 * called from the page (debounced), not a `<form action>`. Writes nothing.
 */
export async function previsualizarFichasAction(itemsJson: string): Promise<VistaPreviaFichasState> {
  try {
    const fichas = await previsualizarFichas({ items: JSON.parse(itemsJson) });
    return { status: "success", fichas };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudo calcular la vista previa de la ficha técnica.") };
  }
}

/**
 * The lab takes a receta from the Pendientes queue (domain/toma.ts) and lands on its toma workspace.
 * Redirects server-side: the revalidated list moves the row to "En curso", unmounting the form before
 * a client-side `onSuccess` could navigate. `redirect` throws, so it stays outside the try/catch.
 */
export async function tomarRecetaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  let recetaId: string;
  try {
    recetaId = (await tomarReceta({ recetaId: String(formData.get("recetaId") ?? "") })).id;
    revalidatePath("/preparaciones");
    revalidatePath("/recetas");
  } catch (error) {
    return actionError(error, "No se pudo tomar la receta.");
  }
  redirect(hrefToma(recetaId));
}

/** Reverts a toma: the receta goes back to Pendientes. */
export async function cancelarTomaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  try {
    const receta = await cancelarToma({ recetaId: String(formData.get("recetaId") ?? "") });
    revalidatePath("/preparaciones");
    revalidatePath("/recetas");
    return { status: "success", message: "Toma cancelada. La receta volvió a Pendientes.", id: receta.id };
  } catch (error) {
    return actionError(error, "No se pudo cancelar la toma.");
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
    return actionError(error, "No se pudo descartar la preparación.");
  }
}

/**
 * Parses the confirm form's per-línea fields (both confirmation actions) back into
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
    // The receta moved to EN_PREPARACION with its first ítem, or PREPARADA with its last.
    revalidatePath("/recetas");
    return { status: "success", message: `Preparación confirmada. Asiento libro recetario Nº ${resultado.numeroCorrelativo}.`, id: resultado.id };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    return actionError(error, "No se pudo confirmar la preparación.");
  }
}

/**
 * What the toma workspace's "Continuar" dialog shows for a ficha técnica: called when it opens, not a
 * `<form action>`. Writes nothing.
 */
export async function getConfirmacionDeFichaAction(fichaTecnicaId: string): Promise<ConfirmacionDeFichaState> {
  try {
    return { status: "success", datos: await getConfirmacionDeFicha(fichaTecnicaId) };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudieron leer los datos para confirmar la preparación.") };
  }
}

/**
 * The "Continuar" dialog's final step: creates the preparación and reserves its stock in one transaction (same form
 * fields as `confirmarPreparacionAction`, keyed by `fichaTecnicaId`). Nothing is descontado nor written to the libro yet.
 */
export async function reservarStockAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  try {
    const resultado = await reservarStockPreparacion({ fichaTecnicaId: String(formData.get("fichaTecnicaId") ?? ""), lineas: parseLineas(formData) });
    revalidatePath("/preparaciones");
    // The receta is no longer editable while the reserva lives (its estado does not change).
    revalidatePath("/recetas");
    return { status: "success", message: "Stock reservado. Al imprimir la etiqueta se descuenta y se registra en el libro recetario.", id: resultado.id };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    return actionError(error, "No se pudo reservar el stock.");
  }
}

/** What the "Modificar reserva" dialog shows: the "Continuar" data prefilled with the current reserva. Writes nothing. */
export async function getModificacionDeReservaAction(preparacionId: string): Promise<ConfirmacionDeFichaState> {
  try {
    return { status: "success", datos: await getModificacionDeReserva(preparacionId) };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudo leer la reserva.") };
  }
}

/** "Modificar reserva": replaces the reserva of the same preparación (same form fields as `reservarStockAction`, keyed by `preparacionId`). */
export async function modificarReservaStockAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  try {
    const resultado = await modificarReservaStock({ preparacionId: String(formData.get("preparacionId") ?? ""), lineas: parseLineas(formData) });
    revalidatePath("/preparaciones");
    return { status: "success", message: "Reserva modificada.", id: resultado.id };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    return actionError(error, "No se pudo modificar la reserva.");
  }
}

/**
 * "Registrar pérdida" on a reserved ítem: an AJUSTE linked to the preparación (with the DT's co-firma in the same form)
 * and the reserva re-planned. The message says whether the reserva still covers the receta.
 */
export async function registrarPerdidaReservaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  try {
    const observacion = String(formData.get("observacion") ?? "").trim();
    const resultado = await registrarPerdidaReserva({
      preparacionId: String(formData.get("preparacionId") ?? ""),
      partidaId: String(formData.get("partidaId") ?? ""),
      cantidad: String(formData.get("cantidad") ?? ""),
      motivoAjuste: String(formData.get("motivoAjuste") ?? "") as RegistrarPerdidaReservaInput["motivoAjuste"],
      observacion: observacion || undefined,
      dtUsuarioId: String(formData.get("dtUsuarioId") ?? ""),
      dtPassword: String(formData.get("dtPassword") ?? ""),
    });
    revalidatePath("/preparaciones");
    revalidatePath("/stock");
    return {
      status: "success",
      message: resultado.reservaAlcanza
        ? "Pérdida registrada. La reserva sigue cubriendo la receta."
        : "Pérdida registrada. La reserva ya no alcanza: modificá la reserva para elegir otro lote.",
    };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    return actionError(error, "No se pudo registrar la pérdida.");
  }
}

/** "Liberar reserva": deletes the ítem's reserva and discards its preparación, so the ítem is Pendiente again. */
export async function liberarReservaStockAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  try {
    await liberarReservaStock(String(formData.get("preparacionId") ?? ""));
    revalidatePath("/preparaciones");
    // The receta may be editable again.
    revalidatePath("/recetas");
    return { status: "success", message: "Reserva liberada. El ítem volvió a Pendiente." };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    return actionError(error, "No se pudo liberar la reserva.");
  }
}

/**
 * "Imprimir etiqueta" on a reserved ítem: confirms the preparación from its reserva (stock, libro recetario,
 * contralor) and generates its etiqueta, in one transaction. `id` is the preparación: the client then opens the print
 * dialog for it.
 */
export async function confirmarReservaStockAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  try {
    const resultado = await confirmarReservaStock(String(formData.get("preparacionId") ?? ""));
    revalidatePath("/preparaciones");
    // The receta moved to EN_PREPARACION with its first ítem, or PREPARADA with its last.
    revalidatePath("/recetas");
    return { status: "success", message: `Preparación confirmada. Asiento libro recetario Nº ${resultado.numeroCorrelativo}.`, id: resultado.id };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required" };
    }
    return actionError(error, "No se pudo confirmar la preparación.");
  }
}

export async function generarEtiquetaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  const preparacionId = String(formData.get("preparacionId") ?? "");
  try {
    await generarEtiqueta({ preparacionId });
    revalidatePath(`/preparaciones/${preparacionId}`);
    return { status: "success", message: "Etiqueta generada." };
  } catch (error) {
    return actionError(error, "No se pudo generar la etiqueta.");
  }
}
