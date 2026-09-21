"use server";

/**
 * Server Action for `/login` (M02, FASE 2 point 2.2). Thin: validate ->
 * call `login()` -> on success write the cookie and redirect, on failure
 * return the SAME generic message `login()` already produced (never
 * re-derive or branch on WHY it failed here -- see
 * modules/auth/application/login.ts's doc comment).
 *
 * CSRF: Next.js Server Actions are protected by a built-in Origin/Host
 * check (see node_modules/next/dist/docs/01-app/02-guides/server-actions.md
 * "Security" -- verified before writing this file, per AGENTS.md); no
 * route handler is used here, so no separate manual Origin check applies.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { email as emailSchema, nonEmptyString } from "@/shared/validation";
import { login } from "@/modules/auth/application/login";
import { writeSessionCookie } from "@/shared/auth/session";

export interface LoginFormState {
  message: string | null;
}

const loginInput = emailSchema;

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const list = await headers();
  const forwardedFor = list.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0]!.trim() : null;
  return { ip, userAgent: list.get("user-agent") };
}

export async function loginAction(_prevState: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const emailResult = loginInput.safeParse(formData.get("email"));
  const passwordResult = nonEmptyString.safeParse(formData.get("password"));

  if (!emailResult.success || !passwordResult.success) {
    return { message: "Ingresá un email y una contraseña válidos." };
  }

  const { ip, userAgent } = await requestMeta();
  const result = await login(emailResult.data, passwordResult.data, ip, userAgent);

  if (!result.ok) {
    return { message: result.message };
  }

  await writeSessionCookie(result.rawToken, result.expiraEn);
  redirect("/");
}
