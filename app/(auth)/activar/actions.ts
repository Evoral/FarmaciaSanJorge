"use server";

/** Server Action for `/activar` (M02, FASE 2 point 2.3). */
import { email as emailSchema, nonEmptyString } from "@/shared/validation";
import { activarCuenta } from "@/modules/auth/application/activar-cuenta";

export interface ActivarFormState {
  message: string | null;
  success: boolean;
}

export async function activarAction(_prevState: ActivarFormState, formData: FormData): Promise<ActivarFormState> {
  const emailResult = emailSchema.safeParse(formData.get("email"));
  const codigoResult = nonEmptyString.safeParse(formData.get("codigo"));
  const passwordResult = nonEmptyString.safeParse(formData.get("password"));
  const passwordRepeatResult = nonEmptyString.safeParse(formData.get("passwordRepeat"));

  if (!emailResult.success || !codigoResult.success || !passwordResult.success || !passwordRepeatResult.success) {
    return { message: "Completá todos los campos.", success: false };
  }

  const result = await activarCuenta(emailResult.data, codigoResult.data, passwordResult.data, passwordRepeatResult.data);

  if (!result.ok) {
    return { message: result.message, success: false };
  }

  return { message: "Cuenta activada. Ya podés iniciar sesión.", success: true };
}
