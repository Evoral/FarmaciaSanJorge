"use server";

/** Server Actions for `/entregas` and `/regularizacion` (FASE 11, M14, points 11.1-11.3). */
import { revalidatePath } from "next/cache";
import { marcarListaParaRetirar } from "@/modules/entregas/application/marcar-lista-para-retirar";
import { registrarEntrega } from "@/modules/entregas/application/registrar-entrega";
import { confirmarFirmaRecibida } from "@/modules/entregas/application/confirmar-firma-recibida";
import { AppError } from "@/shared/errors";
import type { EntregaActionState } from "./action-state";

function fromError(error: unknown, fallback: string): EntregaActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  return { status: "error", message: fallback };
}

function revalidarEntregas(recetaId: string): void {
  revalidatePath("/entregas");
  revalidatePath(`/entregas/${recetaId}`);
  revalidatePath("/regularizacion");
  revalidatePath(`/recetas/${recetaId}`);
}

export async function marcarListaParaRetirarAction(_prevState: EntregaActionState, formData: FormData): Promise<EntregaActionState> {
  try {
    const recetaId = String(formData.get("recetaId") ?? "");
    await marcarListaParaRetirar({ recetaId });
    revalidarEntregas(recetaId);
    return { status: "success", message: "Receta marcada como lista para retirar.", id: recetaId };
  } catch (error) {
    return fromError(error, "No se pudo marcar la receta como lista para retirar.");
  }
}

export async function registrarEntregaAction(_prevState: EntregaActionState, formData: FormData): Promise<EntregaActionState> {
  try {
    const recetaId = String(formData.get("recetaId") ?? "");
    const modalidad = String(formData.get("modalidad") ?? "") as "RETIRO_PRESENCIAL" | "ENVIO";
    const confirmaRecepcionFisica = formData.get("confirmaRecepcionFisica") === "on";
    await registrarEntrega({ recetaId, modalidad, confirmaRecepcionFisica });
    revalidarEntregas(recetaId);
    const mensaje = modalidad === "RETIRO_PRESENCIAL" ? "Entrega registrada." : "Envío registrado: pendiente de confirmar firma recibida.";
    return { status: "success", message: mensaje, id: recetaId };
  } catch (error) {
    return fromError(error, "No se pudo registrar la entrega.");
  }
}

export async function confirmarFirmaRecibidaAction(_prevState: EntregaActionState, formData: FormData): Promise<EntregaActionState> {
  try {
    const recetaId = String(formData.get("recetaId") ?? "");
    await confirmarFirmaRecibida({ recetaId });
    revalidarEntregas(recetaId);
    return { status: "success", message: "Firma recibida confirmada: receta entregada.", id: recetaId };
  } catch (error) {
    return fromError(error, "No se pudo confirmar la firma recibida.");
  }
}
