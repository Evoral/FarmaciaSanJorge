"use client";

/**
 * Submit plumbing for EVERY Server Action form (`<form action>` +
 * `useActionState`): what the user typed must survive an error result.
 *
 * WHY THIS EXISTS: React 19 automatically RESETS a `<form action={fn}>`
 * on every submit -- react-dom's `startHostTransition` calls
 * `requestFormReset(formFiber)` right before running the action, whatever
 * the action ends up returning. A `{ status: "error" }` result (a wrong
 * date, a missing vale number...) therefore threw away everything the user
 * had typed, and a re-auth retry that re-read the DOM with
 * `requestSubmit()` sent an already-wiped form.
 *
 * THE FIX: `onSubmit` calls `event.preventDefault()`. When the submit
 * event's default is prevented, React's form-action listener neither runs
 * the `action` prop nor resets the form (if a transition was started
 * during the event it only calls `startHostTransition` with a `null`
 * action, i.e. a no-op without `requestFormReset`). We build the
 * `FormData` ourselves (including the clicked submitter's name/value),
 * keep it in a ref and dispatch it to `useActionState`'s `formAction`
 * inside a transition. `resubmit()` re-dispatches that SAME stored
 * `FormData` (what `modules/auth/ui/reauth-prompt.tsx`'s
 * `onReauthenticated` calls, via `modules/auth/ui/use-reauth-form-submit.ts`),
 * so a retry never depends on the DOM's current contents. Clearing the
 * form is now the caller's explicit decision, typically `form.reset()` on
 * a success result only (`./simple-form.tsx`).
 *
 * `onSubmit` also clears the previous result's invalid-field marks
 * (`./field-errors.ts`) and stops the submit event's propagation: a form
 * rendered inside another form's React tree (the receta form's
 * paciente/médico/droga pickers) must not also trigger the outer form's
 * `onSubmit`.
 *
 * Callers keep `action={formAction}` on the `<form>` as well: before
 * hydration (no `onSubmit` attached yet) React still wires the Server
 * Action through it, and without it a pre-hydration submit would be a
 * native GET that leaks every field into the URL.
 *
 * Pending state: `useFormStatus` does not reliably track a transition
 * dispatched manually (and never tracks `resubmit()`, which isn't a submit
 * event at all), so callers drive their submit button from
 * `useActionState`'s third return value (`isPending`) instead.
 */
import { startTransition, useCallback, useRef, type FormEvent } from "react";
import { clearInvalidFields } from "./field-errors";

export interface FormSubmit {
  /** Attach as the `<form>`'s `onSubmit` (alongside `action={formAction}`). */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Re-dispatches the last submitted `FormData`. No-op if nothing was submitted yet. */
  resubmit: () => void;
}

export function useFormSubmit(formAction: (payload: FormData) => void): FormSubmit {
  const lastFormData = useRef<FormData | null>(null);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const form = event.currentTarget;
      clearInvalidFields(form);
      const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
      const formData = new FormData(form, submitter);
      lastFormData.current = formData;
      startTransition(() => formAction(formData));
    },
    [formAction],
  );

  const resubmit = useCallback(() => {
    const formData = lastFormData.current;
    if (!formData) return;
    startTransition(() => formAction(formData));
  }, [formAction]);

  return { onSubmit, resubmit };
}
