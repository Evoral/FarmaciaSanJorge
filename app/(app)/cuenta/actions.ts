"use server";

/** Server Actions for `/cuenta` (M02, FASE 2 point 2.4; PIN actions added by the PIN re-auth feature, user decision 2026-09-23). */
import { cambiarPassword } from "@/modules/auth/application/cambiar-password";
import { configurarPin } from "@/modules/auth/application/configurar-pin";
import { eliminarPin } from "@/modules/auth/application/eliminar-pin";
import { AppError } from "@/shared/errors";

export interface CambiarPasswordFormState {
  message: string | null;
  success: boolean;
}

export async function cambiarPasswordAction(_prevState: CambiarPasswordFormState, formData: FormData): Promise<CambiarPasswordFormState> {
  const actual = String(formData.get("actual") ?? "");
  const nueva = String(formData.get("nueva") ?? "");
  const nuevaRepeat = String(formData.get("nuevaRepeat") ?? "");

  try {
    const result = await cambiarPassword(actual, nueva, nuevaRepeat);
    const sesiones = result.sesionesRevocadas;
    const plural = sesiones === 1 ? "otra sesión" : "otras sesiones";
    return {
      message: sesiones > 0 ? `Contraseña actualizada. Se cerraron ${sesiones} ${plural}.` : "Contraseña actualizada.",
      success: true,
    };
  } catch (error) {
    if (error instanceof AppError) {
      return { message: error.message, success: false };
    }
    return { message: "No se pudo actualizar la contraseña.", success: false };
  }
}

export interface PinFormState {
  message: string | null;
  success: boolean;
}

export async function configurarPinAction(_prevState: PinFormState, formData: FormData): Promise<PinFormState> {
  const passwordActual = String(formData.get("passwordActual") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const pinRepeat = String(formData.get("pinRepeat") ?? "");

  try {
    await configurarPin(passwordActual, pin, pinRepeat);
    return { message: "PIN actualizado.", success: true };
  } catch (error) {
    if (error instanceof AppError) {
      return { message: error.message, success: false };
    }
    return { message: "No se pudo actualizar el PIN.", success: false };
  }
}

export async function eliminarPinAction(_prevState: PinFormState, formData: FormData): Promise<PinFormState> {
  const passwordActual = String(formData.get("passwordActualEliminar") ?? "");

  try {
    await eliminarPin(passwordActual);
    return { message: "PIN eliminado.", success: true };
  } catch (error) {
    if (error instanceof AppError) {
      return { message: error.message, success: false };
    }
    return { message: "No se pudo eliminar el PIN.", success: false };
  }
}
