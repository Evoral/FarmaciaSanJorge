/**
 * Building blocks shared by every Server Action form wrapper
 * (`shared/ui/simple-form.tsx`, `modules/auth/ui/reauth-aware-form.tsx`):
 * the base action-state shape, the submit-button variants, the two layouts
 * and the success/error message. Change the look of every form's button,
 * spacing or feedback HERE -- never per call site.
 */
import type { ReactNode } from "react";

/**
 * Base shape every module's `ui/action-state.ts` union conforms to. Module
 * states may carry extra fields (e.g. elaboracion's success `version`).
 * `reauth-required` is only ever acted on by `ReauthAwareForm`; `SimpleForm`
 * accepts states that declare it but treats it as idle. The error's
 * `fields` (built by `./action-error.ts`) name the controls to mark as
 * invalid -- see `./field-errors.ts`.
 */
export type FormActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "success"; message?: string }
  | { status: "reauth-required" };

export type SuccessState<S extends FormActionState> = Extract<S, { status: "success" }>;

/** The field names an error state points at (`undefined` for any other state). */
export function errorFieldsOf(state: { status: string; fields?: readonly string[] }): readonly string[] | undefined {
  return state.status === "error" ? state.fields : undefined;
}

/**
 * - `stack`: a form with fields. The form is a vertical flex column; spacing between fields, message and button
 *   comes from its gap. Callers pass only width constraints (e.g. `max-w-lg`) via `className`.
 * - `inline`: a single button (no fields, or only hidden inputs) meant to sit in a row next to other buttons.
 *   The button carries no margin and the message floats below it, so it never shifts the surrounding layout.
 */
export type FormLayout = "stack" | "inline";

/** Maps 1:1 to the `.btn-*` classes in `app/globals.css`. */
export type ButtonVariant = "primary" | "secondary" | "critical" | "danger" | "danger-solid";

export function buttonClassName(variant: ButtonVariant = "primary", size?: "sm"): string {
  return size === "sm" ? `btn btn-${variant} btn-sm` : `btn btn-${variant}`;
}

export function formClassName(layout: FormLayout, className?: string): string {
  const base = layout === "inline" ? "relative inline-flex" : "flex flex-col gap-4";
  return className ? `${base} ${className}` : base;
}

export interface SubmitButtonProps {
  label: string;
  pendingLabel: string;
  pending: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  /** `"sm"` for buttons inside table rows, next to other `btn-sm` actions. */
  size?: "sm";
}

export function SubmitButton({ label, pendingLabel, pending, disabled, variant, size }: SubmitButtonProps) {
  return (
    <button type="submit" disabled={pending || disabled} className={buttonClassName(variant, size)}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/** Wraps the submit button in `stack` layout so it keeps its intrinsic width inside the flex column. */
export function FormActions({ layout, children }: { layout: FormLayout; children: ReactNode }) {
  return layout === "inline" ? <>{children}</> : <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

const TONE_CLASS = {
  error: "text-red-600 dark:text-red-400",
  success: "text-emerald-600 dark:text-emerald-400",
} as const;

const FLOATING_CLASS = "absolute right-0 top-full mt-1 w-max max-w-xs text-right";

export interface FormMessageProps {
  tone: "error" | "success";
  /** `true` in `inline` layout: positioned below the button, outside the flow. */
  floating?: boolean;
  children: ReactNode;
}

export function FormMessage({ tone, floating = false, children }: FormMessageProps) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`text-sm ${TONE_CLASS[tone]}${floating ? ` ${FLOATING_CLASS}` : ""}`}>
      {children}
    </p>
  );
}

export interface FormFeedbackProps<S extends FormActionState> {
  state: S;
  layout: FormLayout;
  /** Overrides the success text (default: the state's own `message`, hidden when absent). */
  successMessage?: (state: SuccessState<S>) => string | undefined;
}

/** Renders the error / success message (if any) for an action state. */
export function FormFeedback<S extends FormActionState>({ state, layout, successMessage }: FormFeedbackProps<S>) {
  const current: FormActionState = state;
  const floating = layout === "inline";

  if (current.status === "error") {
    return (
      <FormMessage tone="error" floating={floating}>
        {current.message}
      </FormMessage>
    );
  }

  if (current.status === "success") {
    const text = successMessage ? successMessage(state as SuccessState<S>) : current.message;
    return text ? (
      <FormMessage tone="success" floating={floating}>
        {text}
      </FormMessage>
    ) : null;
  }

  return null;
}
