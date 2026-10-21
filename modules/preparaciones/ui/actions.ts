"use server";

/** Server Actions for `/preparaciones/**` (FASE 8). */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hrefToma } from "@/modules/preparaciones/domain/toma";
import { tomarReceta } from "@/modules/preparaciones/application/tomar-receta";
import { cancelarToma } from "@/modules/preparaciones/application/cancelar-toma";
import { descartarPreparacion } from "@/modules/preparaciones/application/descartar-preparacion";
import { confirmarPreparacion } from "@/modules/preparaciones/application/confirmar-preparacion";
import type { LineaEntradaInput } from "@/modules/preparaciones/application/confirmar-preparacion";
import type { TipoVencimientoPreparado } from "@/modules/preparaciones/domain/vencimiento";
import { reservarStockPreparacion } from "@/modules/preparaciones/application/reservar-stock-preparacion";
import { liberarReservaStock } from "@/modules/preparaciones/application/liberar-reserva-stock";
import { confirmarReservasReceta } from "@/modules/preparaciones/application/confirmar-reservas-receta";
import { recalcularReservaStock } from "@/modules/preparaciones/application/recalcular-reserva-stock";
import { getRecalculoDeReserva } from "@/modules/preparaciones/application/get-recalculo-de-reserva";
import { registrarPerdidaReserva, type RegistrarPerdidaReservaInput } from "@/modules/preparaciones/application/registrar-perdida-reserva";
import { getConfirmacionDeFicha } from "@/modules/preparaciones/application/get-confirmacion-de-ficha";
import { generarEtiqueta } from "@/modules/preparaciones/application/generar-etiqueta";
import { previsualizarFichas } from "@/modules/preparaciones/application/previsualizar-fichas";
import { guardarExcipientePreparacion } from "@/modules/preparaciones/application/guardar-excipiente-preparacion";
import { guardarBorradorPesada } from "@/modules/preparaciones/application/guardar-borrador-pesada";
import { guardarExcipienteBorrador } from "@/modules/preparaciones/application/guardar-excipiente-borrador";
import { StepUpRequiredError } from "@/shared/errors";
import { conOperador } from "@/shared/auth/operador-context";
import { actionError, actionErrorMessage } from "@/shared/ui/action-error";
import type { ConfirmacionDeFichaState, PreparacionActionState, VistaPreviaFichasState } from "./action-state";

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
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    let recetaId: string;
    try {
      recetaId = (await tomarReceta({ recetaId: String(formData.get("recetaId") ?? "") })).id;
      revalidatePath("/preparaciones");
      revalidatePath("/recetas");
    } catch (error) {
      return actionError(error, "No se pudo tomar la receta.");
    }
    redirect(hrefToma(recetaId));
  });
}

/** Reverts a toma: the receta goes back to Pendientes. */
export async function cancelarTomaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    try {
      const receta = await cancelarToma({ recetaId: String(formData.get("recetaId") ?? "") });
      revalidatePath("/preparaciones");
      revalidatePath("/recetas");
      return { status: "success", message: "Toma cancelada. La receta volvió a Pendientes.", id: receta.id };
    } catch (error) {
      return actionError(error, "No se pudo cancelar la toma.");
    }
  });
}

export async function descartarPreparacionAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
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
  });
}

/**
 * Parses the reserva / confirmation form's per-línea entradas back into `LineaEntradaInput[]` (2026-10-15: the
 * partidas are the system's, docs/specs/reserva-stock-preparacion.md R1 -- except a línea whose partidas differ in
 * purity, R25). Field names (built by `modules/preparaciones/ui/confirmar-form.tsx`):
 *   - `lineaIds` (repeated, one per línea with something to type)
 *   - `cantidadManual_<lineaId>` (manual-enrase lines only)
 *   - `motivoApertura_<lineaId>` (optional, INV-S18)
 *   - `partidas_<lineaId>` (repeated checkbox: the lots the línea is weighed from, docs/specs/pesada-real.md)
 *   - `cantidadReal_<lineaId>` (non-manual lines: the real weighing, docs/specs/pesada-real.md)
 * A one-click form sends none of them. `dtUsuarioId` / `dtPassword` (the DT co-firma of a pesada real outside the
 * tolerance) are read by `coFirmaPesada`.
 */
function parseEntradas(formData: FormData): LineaEntradaInput[] {
  return formData.getAll("lineaIds").map((valor) => {
    const lineaPesajeId = String(valor);
    const cantidadManualRaw = formData.get(`cantidadManual_${lineaPesajeId}`);
    const motivoRaw = formData.get(`motivoApertura_${lineaPesajeId}`);
    const partidaIds = formData.getAll(`partidas_${lineaPesajeId}`).map(String);
    const cantidadRealRaw = formData.get(`cantidadReal_${lineaPesajeId}`);
    return {
      lineaPesajeId,
      cantidadManual: cantidadManualRaw ? String(cantidadManualRaw) : undefined,
      motivoAperturaAdicional: motivoRaw && String(motivoRaw).trim().length > 0 ? String(motivoRaw) : undefined,
      partidaIds: partidaIds.length > 0 ? partidaIds : undefined,
      cantidadReal: cantidadRealRaw && String(cantidadRealRaw).trim().length > 0 ? String(cantidadRealRaw).trim() : undefined,
    };
  });
}

/** The DT co-firma block of the reserva / confirmation form: only rendered when a pesada real is outside the tolerance. */
function coFirmaPesada(formData: FormData): { dtUsuarioId?: string; dtPassword?: string } {
  const dtUsuarioId = String(formData.get("dtUsuarioId") ?? "");
  const dtPassword = String(formData.get("dtPassword") ?? "");
  return { dtUsuarioId: dtUsuarioId || undefined, dtPassword: dtPassword || undefined };
}

export async function confirmarPreparacionAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    const preparacionId = String(formData.get("preparacionId") ?? "");
    try {
      const resultado = await confirmarPreparacion({
        preparacionId,
        lineas: parseEntradas(formData),
        ...coFirmaPesada(formData),
        tipoVencimiento: (formData.get("tipoVencimiento") || undefined) as TipoVencimientoPreparado | undefined,
      });
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
  });
}

/**
 * What the toma workspace's "Marcar como preparada" dialog shows for a ficha técnica (the automatic plan): called
 * when it opens, not a `<form action>`. Writes nothing.
 */
export async function getConfirmacionDeFichaAction(fichaTecnicaId: string): Promise<ConfirmacionDeFichaState> {
  try {
    return { status: "success", datos: await getConfirmacionDeFicha(fichaTecnicaId) };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudieron leer los datos para confirmar la preparación.") };
  }
}

/**
 * "Marcar como preparada" (one click, or the dialog's submit): creates the preparación and reserves its stock
 * automatically in one transaction (same form fields as `confirmarPreparacionAction`, keyed by `fichaTecnicaId`).
 * Nothing is descontado nor written to the libro yet.
 */
/** Toma workspace: saves the excipiente used of a reserved ítem when its field is left (migration 0083). No revalidation: the field already shows it. */
export async function guardarExcipienteAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    try {
      const preparacionId = String(formData.get("preparacionId") ?? "");
      await guardarExcipientePreparacion({ preparacionId, excipiente: String(formData.get("excipiente") ?? "") || null });
      return { status: "success", id: preparacionId };
    } catch (error) {
      return { ...actionError(error, "No se pudo guardar el excipiente."), fields: ["excipiente"] };
    }
  });
}

/**
 * Toma workspace: saves one línea's pesada en borrador (migration 0090) as the lab fills it in -- lots in order, real
 * weighing / enrase quantity, motivo. Blank quantities clear them. No revalidation: the fields already show it.
 */
export async function guardarBorradorPesadaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    const lineaPesajeId = String(formData.get("lineaPesajeId") ?? "");
    const texto = (nombre: string) => {
      const valor = String(formData.get(nombre) ?? "").trim();
      return valor.length > 0 ? valor : undefined;
    };
    try {
      await guardarBorradorPesada({
        lineaPesajeId,
        partidaIds: formData.getAll("partidaIds").map(String),
        cantidadReal: texto("cantidadReal"),
        cantidadManual: texto("cantidadManual"),
        motivoAperturaAdicional: texto("motivoAperturaAdicional"),
      });
      return { status: "success", id: lineaPesajeId };
    } catch (error) {
      return actionError(error, "No se pudo guardar la línea.");
    }
  });
}

/** Toma workspace: saves the ficha's excipiente draft (migration 0092) as it is chosen or its quantity is left. */
export async function guardarExcipienteBorradorAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    const fichaTecnicaId = String(formData.get("fichaTecnicaId") ?? "");
    const drogaId = String(formData.get("excipienteDrogaId") ?? "").trim();
    const cantidad = String(formData.get("excipienteCantidad") ?? "").trim();
    try {
      await guardarExcipienteBorrador({ fichaTecnicaId, drogaId: drogaId || null, cantidad: cantidad || undefined });
      return { status: "success", id: fichaTecnicaId };
    } catch (error) {
      return actionError(error, "No se pudo guardar el excipiente.");
    }
  });
}

/** The excipiente the reserva form sends (migration 0092): only when one is chosen; its quantity is then required. */
function excipienteDe(formData: FormData): { drogaId: string; cantidad: string } | undefined {
  const drogaId = String(formData.get("excipienteDrogaId") ?? "").trim();
  return drogaId ? { drogaId, cantidad: String(formData.get("excipienteCantidad") ?? "") } : undefined;
}

export async function reservarStockAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    try {
      const resultado = await reservarStockPreparacion({
        fichaTecnicaId: String(formData.get("fichaTecnicaId") ?? ""),
        lineas: parseEntradas(formData),
        excipiente: excipienteDe(formData),
        ...coFirmaPesada(formData),
      });
      revalidatePath("/preparaciones");
      // The receta is no longer editable while the reserva lives (its estado does not change).
      revalidatePath("/recetas");
      return { status: "success", message: "Ítem marcado como preparado (stock reservado). Al imprimir las etiquetas de la receta se descuenta y se registra en el libro recetario.", id: resultado.id };
    } catch (error) {
      if (error instanceof StepUpRequiredError) {
        return { status: "reauth-required" };
      }
      return actionError(error, "No se pudo reservar el stock.");
    }
  });
}

/** What the "Recalcular reserva" dialog shows: the automatic plan, prefilled with the current reserva's enrase quantity/motivo. Writes nothing. */
export async function getRecalculoDeReservaAction(preparacionId: string): Promise<ConfirmacionDeFichaState> {
  try {
    return { status: "success", datos: await getRecalculoDeReserva(preparacionId) };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudo leer la reserva.") };
  }
}

/**
 * "Recalcular reserva": re-plans the reserva of the same preparación automatically (same form fields as
 * `reservarStockAction`, keyed by `preparacionId`; the one-click form sends none and keeps the current entradas).
 */
export async function recalcularReservaStockAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    try {
      const resultado = await recalcularReservaStock({ preparacionId: String(formData.get("preparacionId") ?? ""), lineas: parseEntradas(formData), ...coFirmaPesada(formData) });
      revalidatePath("/preparaciones");
      return { status: "success", message: "Reserva recalculada.", id: resultado.id };
    } catch (error) {
      if (error instanceof StepUpRequiredError) {
        return { status: "reauth-required" };
      }
      return actionError(error, "No se pudo recalcular la reserva.");
    }
  });
}

/**
 * "Registrar pérdida" on a reserved ítem: an AJUSTE linked to the preparación (with the DT's co-firma in the same form)
 * and the reserva re-planned automatically. The message says whether the droga still covers the receta.
 */
export async function registrarPerdidaReservaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
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
          : "Pérdida registrada. La reserva ya no alcanza: no queda stock suficiente de la droga.",
      };
    } catch (error) {
      if (error instanceof StepUpRequiredError) {
        return { status: "reauth-required" };
      }
      return actionError(error, "No se pudo registrar la pérdida.");
    }
  });
}

/** "Liberar reserva": deletes the ítem's reserva and discards its preparación, so the ítem is Pendiente again. */
export async function liberarReservaStockAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
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
  });
}

/** "Se confirmaron 3 ítems. Asiento libro recetario Nº 101." -- one asiento for the whole receta (D8). */
const PREFIJO_TIPO_VENCIMIENTO = "tipoVencimiento_";

/** "Imprimir etiquetas"'s per-ítem selectors (`tipoVencimiento_<preparacionId>`); the command validates every value. */
function tiposVencimientoPorPreparacion(formData: FormData): Record<string, TipoVencimientoPreparado> {
  const tipos: Record<string, TipoVencimientoPreparado> = {};
  for (const [clave, valor] of formData.entries()) {
    if (clave.startsWith(PREFIJO_TIPO_VENCIMIENTO) && typeof valor === "string") {
      tipos[clave.slice(PREFIJO_TIPO_VENCIMIENTO.length)] = valor as TipoVencimientoPreparado;
    }
  }
  return tipos;
}

function mensajeReservasConfirmadas(items: number, numeroCorrelativo: string): string {
  return `${items === 1 ? "Se confirmó 1 ítem" : `Se confirmaron ${items} ítems`}. Asiento libro recetario Nº ${numeroCorrelativo}.`;
}

/**
 * The toma workspace's "Imprimir etiquetas": confirms every ítem of the receta from its reserva (stock, libro
 * recetario, contralor) and generates their etiquetas, in one transaction -- only when every ítem not yet confirmed holds
 * a reserva. The client then opens the per-ítem print dialog. The ONLY action that confirms a reserva: there is no
 * single-ítem one, so the receta's ítems always share ONE asiento (D8).
 */
export async function confirmarReservasRecetaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    try {
      const confirmada = await confirmarReservasReceta(String(formData.get("recetaId") ?? ""), tiposVencimientoPorPreparacion(formData));
      revalidatePath("/preparaciones");
      // The receta moved to PREPARADA.
      revalidatePath("/recetas");
      return { status: "success", message: mensajeReservasConfirmadas(confirmada.etiquetas.length, confirmada.numeroCorrelativo) };
    } catch (error) {
      if (error instanceof StepUpRequiredError) {
        return { status: "reauth-required" };
      }
      return actionError(error, "No se pudieron confirmar los ítems de la receta.");
    }
  });
}

export async function generarEtiquetaAction(_prevState: PreparacionActionState, formData: FormData): Promise<PreparacionActionState> {
  return conOperador(formData, async (): Promise<PreparacionActionState> => {
    const preparacionId = String(formData.get("preparacionId") ?? "");
    try {
      await generarEtiqueta({ preparacionId });
      revalidatePath(`/preparaciones/${preparacionId}`);
      return { status: "success", message: "Etiqueta generada." };
    } catch (error) {
      return actionError(error, "No se pudo generar la etiqueta.");
    }
  });
}
