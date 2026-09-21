"use server";

/** Server Action for `/cuenta` (M02, FASE 2 point 2.4). */
import { cambiarPassword } from "@/modules/auth/application/cambiar-password";
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
