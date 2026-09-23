"use server";

/**
 * Server Actions backing `modules/auth/ui/reauth-prompt.tsx` (FASE 2 point
 * 2.5; PIN branch + `pinDisponibleAction` added by the PIN re-auth
 * feature, user decision 2026-09-23).
 */
import { reautenticar } from "@/modules/auth/application/reautenticar";
import { pinDisponible } from "@/modules/auth/application/pin-status";
import { AppError } from "@/shared/errors";

export interface ReautenticarActionResult {
  ok: boolean;
  message: string;
}

/** `credential` is either the full password or the 6-digit PIN -- never both, see `reautenticar()`'s input union. */
export async function reautenticarAction(credential: { password: string } | { pin: string }): Promise<ReautenticarActionResult> {
  try {
    await reautenticar(credential);
    return { ok: true, message: "" };
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "No se pudo confirmar la credencial." };
  }
}

/** Whether the current session's usuario has an active PIN -- lets the prompt default to a PIN input. Never throws: any failure (should be unreachable -- the prompt only renders for an already-authenticated session) falls back to `false` (password input), the safer default. */
export async function pinDisponibleAction(): Promise<boolean> {
  try {
    return await pinDisponible();
  } catch {
    return false;
  }
}
