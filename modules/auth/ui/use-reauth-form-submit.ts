"use client";

/**
 * Submit/resubmit plumbing shared by every form that can come back with
 * `{ status: "reauth-required" }` and then show
 * `./reauth-prompt.tsx` (`./reauth-aware-form.tsx`, `/admin/accesos/usuarios/nuevo`, `/admin/accesos/directores-tecnicos/nuevo`,
 * "Restablecer credencial").
 *
 * A thin, re-auth-flavoured name for `shared/ui/use-form-submit.ts`'s
 * `useFormSubmit` (which every Server Action form uses now): React 19
 * auto-resets a `<form action>` on every submit, so the re-auth retry must
 * NOT re-read the DOM with `requestSubmit()` (it would send empty inputs,
 * or the `defaultValue`/`defaultChecked` values -- e.g. "Elegí al menos un
 * rol" when creating a user, "No hay cambios de roles para aplicar." when
 * editing roles, an empty DT designation). `resubmit()` -- what
 * `ReauthPrompt`'s `onReauthenticated` calls -- re-dispatches the SAME
 * `FormData` captured on the original submit instead. See that file for
 * the full rationale, including why the submit button's pending state
 * comes from `useActionState`'s `isPending` rather than `useFormStatus`.
 */
import { useFormSubmit, type FormSubmit } from "@/shared/ui/use-form-submit";

export type ReauthFormSubmit = FormSubmit;

export function useReauthFormSubmit(formAction: (payload: FormData) => void): ReauthFormSubmit {
  return useFormSubmit(formAction);
}
