"use server";

/** Server Action backing `modules/auth/ui/reauth-prompt.tsx` (FASE 2 point 2.5). */
import { reautenticar } from "@/modules/auth/application/reautenticar";
import { AppError } from "@/shared/errors";

export interface ReautenticarActionResult {
  ok: boolean;
  message: string;
}

export async function reautenticarAction(password: string): Promise<ReautenticarActionResult> {
  try {
    await reautenticar(password);
    return { ok: true, message: "" };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "No se pudo confirmar la contraseña." };
  }
}
