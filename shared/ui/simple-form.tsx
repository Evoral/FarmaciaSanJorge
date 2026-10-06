"use client";

/**
 * Minimal Server Action form wrapper, shared by every module (no
 * re-authentication branch -- see `modules/auth/ui/reauth-aware-form.tsx`
 * for actions that require recent re-auth). Renders `children` (the form's
 * own fields) inside a `<form action>`, shows the action's error/success
 * message, and on success resets the form, runs `router.refresh()` and
 * then `onSuccess`. Layout, button variants and message styling live in
 * `./form-parts.tsx`.
 *
 * An error result NEVER clears what the user typed: submits go through
 * `./use-form-submit.ts` (which bypasses React 19's automatic reset of a
 * `<form action>`), the form is reset explicitly on success only, and the
 * error's `fields` are marked invalid (`./field-errors.ts`).
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
} from "./form-parts";
import { useFieldErrors } from "./field-errors";
import { useFormSubmit } from "./use-form-submit";

export type { ButtonVariant, FormActionState, FormLayout } from "./form-parts";

export interface SimpleFormProps<S extends FormActionState> {
  action: (prevState: S, formData: FormData) => Promise<S>;
  children?: ReactNode;
  submitLabel: string;
  /** Defaults to "Guardando…". */
  pendingLabel?: string;
  /** Defaults to `"primary"`. */
  submitVariant?: ButtonVariant;
  /** `"sm"` inside table rows. */
  submitSize?: "sm";
  submitDisabled?: boolean;
  /** Floating note explaining why the submit is disabled (see `SubmitButton`). */
  submitDisabledReason?: ReactNode;
  /** Defaults to `"stack"` -- see `FormLayout`. */
  layout?: FormLayout;
  /** Extra buttons (e.g. "Cancelar", always `type="button"`) rendered in the same actions row, after the submit button. `stack` layout only. */
  extraActions?: ReactNode;
  /** Width constraints only (e.g. `max-w-lg`); spacing comes from the layout. */
  className?: string;
  /** Overrides the success text (default: the state's own `message`). */
  successMessage?: (state: SuccessState<S>) => string | undefined;
  onSuccess?: (state: SuccessState<S>) => void;
}

export function SimpleForm<S extends FormActionState>({
  action,
  children,
  submitLabel,
  pendingLabel = "Guardando…",
  submitVariant,
  submitSize,
  submitDisabled,
  submitDisabledReason,
  layout = "stack",
  className,
  extraActions,
  successMessage,
  onSuccess,
}: SimpleFormProps<S>) {
  const [state, formAction, isPending] = useActionState(action, { status: "idle" } as Awaited<S>);
  const { onSubmit } = useFormSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
      onSuccess?.(state as SuccessState<S>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useFieldErrors(formRef, errorFieldsOf(state));

  const feedback = <FormFeedback state={state} layout={layout} successMessage={successMessage} />;

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className={formClassName(layout, className)}>
      {children}
      {layout === "stack" ? feedback : null}
      <FormActions layout={layout}>
        <SubmitButton pending={isPending} label={submitLabel} pendingLabel={pendingLabel} disabled={submitDisabled} disabledReason={submitDisabledReason} variant={submitVariant} size={submitSize} />
        {layout === "stack" ? extraActions : null}
      </FormActions>
      {layout === "inline" ? feedback : null}
    </form>
  );
}
