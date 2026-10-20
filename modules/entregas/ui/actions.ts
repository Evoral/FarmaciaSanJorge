"use server";

/** Server Actions for `/entregas` (FASE 11, M14, points 11.1-11.2). */
import { revalidatePath } from "next/cache";
import { registrarEntrega } from "@/modules/entregas/application/registrar-entrega";
import { confirmarFirmaRecibida } from "@/modules/entregas/application/confirmar-firma-recibida";
import { anularEntrega } from "@/modules/entregas/application/anular-entrega";
import { cambiarRepartidor } from "@/modules/entregas/application/cambiar-repartidor";
import { conOperador } from "@/shared/auth/operador-context";
import { actionError } from "@/shared/ui/action-error";
import type { EntregaActionState } from "./action-state";

function fromError(error: unknown, fallback: string): EntregaActionState {
  return actionError(error, fallback);
}

function revalidarEntregas(recetaId: string): void {
  revalidatePath("/entregas");
  revalidatePath(`/entregas/${recetaId}`);
  revalidatePath(`/recetas/${recetaId}`);
}

export async function registrarEntregaAction(_prevState: EntregaActionState, formData: FormData): Promise<EntregaActionState> {
  return conOperador(formData, async (): Promise<EntregaActionState> => {
    try {
      const recetaId = String(formData.get("recetaId") ?? "");
      const modalidad = String(formData.get("modalidad") ?? "") as "RETIRO_PRESENCIAL" | "ENVIO";
      // Empty string (nothing picked) is "no repartidor": the use case's schema then asks for one on an ENVIO.
      const repartidorId = String(formData.get("repartidorId") ?? "") || undefined;
      // Sent only by the envío form of a receta without domicilio (E4); the use case rejects it in every other case.
      const domicilio = String(formData.get("domicilio") ?? "");
      await registrarEntrega({ recetaId, modalidad, pagada: formData.get("pagada") === "on", repartidorId, domicilio });
      revalidarEntregas(recetaId);
      const mensaje = modalidad === "RETIRO_PRESENCIAL" ? "Entrega registrada." : "Envío registrado: pendiente de confirmar su retorno.";
      return { status: "success", message: mensaje, id: recetaId };
    } catch (error) {
      return fromError(error, "No se pudo registrar la entrega.");
    }
  });
}

export async function cambiarRepartidorAction(_prevState: EntregaActionState, formData: FormData): Promise<EntregaActionState> {
  return conOperador(formData, async (): Promise<EntregaActionState> => {
    try {
      const recetaId = String(formData.get("recetaId") ?? "");
      await cambiarRepartidor({ recetaId, repartidorId: String(formData.get("repartidorId") ?? "") });
      revalidarEntregas(recetaId);
      return { status: "success", message: "Repartidor actualizado.", id: recetaId };
    } catch (error) {
      return fromError(error, "No se pudo cambiar el repartidor.");
    }
  });
}

export async function anularEntregaAction(_prevState: EntregaActionState, formData: FormData): Promise<EntregaActionState> {
  return conOperador(formData, async (): Promise<EntregaActionState> => {
    try {
      const recetaId = String(formData.get("recetaId") ?? "");
      await anularEntrega({ recetaId, motivo: String(formData.get("motivo") ?? ""), marcarImpaga: formData.get("marcarImpaga") === "on" });
      revalidarEntregas(recetaId);
      return { status: "success", message: "Entrega anulada: la receta volvió a Entregas.", id: recetaId };
    } catch (error) {
      return fromError(error, "No se pudo anular la entrega.");
    }
  });
}

export async function confirmarFirmaRecibidaAction(_prevState: EntregaActionState, formData: FormData): Promise<EntregaActionState> {
  return conOperador(formData, async (): Promise<EntregaActionState> => {
    try {
      const recetaId = String(formData.get("recetaId") ?? "");
      await confirmarFirmaRecibida({ recetaId, pagada: formData.get("pagada") === "on" });
      revalidarEntregas(recetaId);
      return { status: "success", message: "Retorno confirmado: receta entregada.", id: recetaId };
    } catch (error) {
      return fromError(error, "No se pudo confirmar el retorno.");
    }
  });
}
