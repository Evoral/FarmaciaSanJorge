"use server";

/** Server Actions for `/cuenta` (M02, FASE 2 point 2.4; PIN actions added by the PIN re-auth feature, user decision 2026-09-23). */
import { revalidatePath } from "next/cache";
import { cambiarPassword } from "@/modules/auth/application/cambiar-password";
import { configurarPin } from "@/modules/auth/application/configurar-pin";
import { eliminarCredencialOperador, type EliminarCredencialOperadorInput } from "@/modules/auth/application/eliminar-credencial-operador";
import { registrarCredencialOperador, type RegistrarCredencialOperadorInput } from "@/modules/auth/application/registrar-credencial-operador";
import { actionError, actionErrorMessage } from "@/shared/ui/action-error";

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
    return { message: actionErrorMessage(error, "No se pudo actualizar la contraseña."), success: false };
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
    return { message: actionErrorMessage(error, "No se pudo actualizar el PIN."), success: false };
  }
}

/**
 * State of the «Huella» panel forms (openspec/changes/metodos-verificacion-operador). `fields` points at the control
 * the error is about (`shared/ui/field-errors.ts` marks it), e.g. a code that is too short or already in use.
 */
export interface CredencialOperadorFormState {
  message: string | null;
  success: boolean;
  fields?: string[];
}

/** Only the methods whose code the empleado enrols themselves; anything else is rejected by the use case's own enum. */
function metodoDelFormulario(formData: FormData): string {
  return String(formData.get("metodo") ?? "");
}

/** Enrols or replaces (the same write) the empleado's own code for a method. Not an acción con PIN: no `conOperador`. */
export async function registrarCredencialOperadorAction(_prevState: CredencialOperadorFormState, formData: FormData): Promise<CredencialOperadorFormState> {
  const metodo = metodoDelFormulario(formData);
  try {
    // The code travels under the method's own proof key (`huella`), which the logger redacts.
    await registrarCredencialOperador({
      metodo: metodo as RegistrarCredencialOperadorInput["metodo"],
      passwordActual: String(formData.get("passwordActual") ?? ""),
      huella: String(formData.get("huella") ?? ""),
    });
    revalidatePath("/cuenta");
    return { message: "Huella guardada. Ya podés identificarte con ella.", success: true };
  } catch (error) {
    const { message, fields } = actionError(error, "No se pudo guardar la huella.");
    return { message, success: false, ...(fields ? { fields } : {}) };
  }
}

/** Removes the empleado's own code for a method. Always allowed, even while the farmacia has the method off. */
export async function eliminarCredencialOperadorAction(_prevState: CredencialOperadorFormState, formData: FormData): Promise<CredencialOperadorFormState> {
  try {
    await eliminarCredencialOperador({ metodo: metodoDelFormulario(formData) as EliminarCredencialOperadorInput["metodo"] });
    revalidatePath("/cuenta");
    return { message: "Huella eliminada. Ya no te identifica.", success: true };
  } catch (error) {
    return { message: actionErrorMessage(error, "No se pudo eliminar la huella."), success: false };
  }
}
