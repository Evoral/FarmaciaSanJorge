/**
 * Server-side helper every Server Action uses to turn a caught error into
 * the `{ status: "error" }` variant of its action state. Deliberately NOT a
 * `"use client"` / `"use server"` module: it is a plain function imported by
 * `"use server"` files (which may only EXPORT async functions themselves).
 *
 * - The message is `userMessageFor(error, fallback)` (shared/errors): always
 *   Spanish, never a raw DB text or an `INV-XXX` code -- invariant
 *   violations go through the global translation table, authentication/
 *   authorization errors get fixed messages, and unexpected errors (not an
 *   `AppError`, or `INTERNAL_ERROR`) get the action's own `fallback`.
 * - The raw error is logged server-side first (`logErrorForDiagnostics`),
 *   so the translation never loses diagnostics.
 * - An `AppError`'s `fields` (if any -- see `shared/errors`'s
 *   `AppErrorOptions`) travel along so the form can mark exactly those
 *   controls (`shared/ui/field-errors.ts`).
 *
 * `fields` is omitted (not `undefined`) when there are none, so the
 * serialized state stays identical to what actions returned before.
 */
import { AppError, logErrorForDiagnostics, userMessageFor } from "@/shared/errors";

export interface ActionErrorState {
  status: "error";
  message: string;
  fields?: string[];
}

export function actionError(error: unknown, fallback: string): ActionErrorState {
  logErrorForDiagnostics(error, { origen: "server-action" });
  const message = userMessageFor(error, fallback);
  if (error instanceof AppError && error.fields && error.fields.length > 0) return { status: "error", message, fields: [...error.fields] };
  return { status: "error", message };
}

/** Just the user-facing message, for Server Actions whose error state has a different shape (search pickers, `/cuenta` forms, the re-auth prompt). Logs like `actionError`. */
export function actionErrorMessage(error: unknown, fallback: string): string {
  return actionError(error, fallback).message;
}
