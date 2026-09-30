"use client";

/**
 * Generic wrapper for every sensitive Server Action that requires recent
 * re-authentication (usuarios, farmacia, parametros, directores-tecnicos,
 * libro anulación/rectificación, preparaciones confirmación). Same props,
 * layouts and message styling as `shared/ui/simple-form.tsx` (both build on
 * `shared/ui/form-parts.tsx`), plus the re-auth branch: a
 * `{ status: "reauth-required" }` result shows `./reauth-prompt.tsx` and,
 * once re-authentication succeeds, RESUBMITS THE SAME DATA via
 * `useReauthFormSubmit`'s `resubmit()` (re-dispatches the exact `FormData`
 * captured on the original submit -- nothing needs to be re-entered). It
 * deliberately does NOT re-read the DOM with `requestSubmit()`: React 19
 * auto-resets a `<form action>` on every submit, so the fields would
 * already be empty/back to their defaults. See `./use-reauth-form-submit.ts`
 * for the full rationale (including why the submit button's pending state
 * comes from `useActionState`'s `isPending` rather than `useFormStatus`).
 * Because of that, an error result also keeps everything the user typed
 * (the form is not reset on success either, as before), and the error's
 * `fields` are marked invalid (`shared/ui/field-errors.ts`).
 */
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  FormActions,
  FormFeedback,
  SubmitButton,
  errorFieldsOf,
  formClassName,
  type ButtonVariant,
  type FormActionState,
  type FormLayout,
  type SuccessState,
} from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { ReauthPrompt } from "./reauth-prompt";
import { useReauthFormSubmit } from "./use-reauth-form-submit";

export interface ReauthAwareFormProps<S extends FormActionState> {
  action: (prevState: S, formData: FormData) => Promise<S>;
  children?: ReactNode;
  submitLabel: string;
  /** Defaults to "Guardando…". */
  pendingLabel?: string;
  /** Defaults to `"primary"`. */
  submitVariant?: ButtonVariant;
  submitDisabled?: boolean;
  /** Defaults to `"stack"` -- see `FormLayout`. */
  layout?: FormLayout;
  /** Extra buttons (e.g. "Cancelar", always `type="button"`) rendered in the same actions row, after the submit button. `stack` layout only. */
  extraActions?: ReactNode;
  /** Width constraints only (e.g. `max-w-lg`); spacing comes from the layout. */
  className?: string;
  /** Called after a successful submit, in addition to `router.refresh()` (which always runs on success so the server-rendered page reflects the change). */
  onSuccess?: (state: SuccessState<S>) => void;
}

export function ReauthAwareForm<S extends FormActionState>({
  action,
  children,
  submitLabel,
  pendingLabel = "Guardando…",
  submitVariant,
  submitDisabled,
  layout = "stack",
  className,
  extraActions,
  onSuccess,
}: ReauthAwareFormProps<S>) {
  const [state, formAction, isPending] = useActionState(action, { status: "idle" } as Awaited<S>);
  const { onSubmit, resubmit } = useReauthFormSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onSuccess?.(state as SuccessState<S>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useFieldErrors(formRef, errorFieldsOf(state));

  const feedback = <FormFeedback state={state} layout={layout} />;

  return (
    <>
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className={formClassName(layout, className)}>
        {children}
        {layout === "stack" ? feedback : null}
        <FormActions layout={layout}>
          <SubmitButton pending={isPending} label={submitLabel} pendingLabel={pendingLabel} disabled={submitDisabled} variant={submitVariant} />
          {layout === "stack" ? extraActions : null}
        </FormActions>
        {layout === "inline" ? feedback : null}
      </form>

      {state.status === "reauth-required" ? <ReauthPrompt onReauthenticated={resubmit} onCancel={() => undefined} /> : null}
    </>
  );
}
