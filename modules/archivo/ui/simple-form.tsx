"use client";

/** Minimal Server Action form wrapper for `/archivo/**`. Own copy per module -- see modules/cierres/ui/simple-form.tsx. */
import { useActionState, useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ArchivoActionState } from "./action-state";
import { IDLE_STATE } from "./action-state";

function SubmitButton({ label, pendingLabel, className, disabled }: { label: string; pendingLabel: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className ?? "rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export interface SimpleFormProps {
  action: (prevState: ArchivoActionState, formData: FormData) => Promise<ArchivoActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  submitDisabled?: boolean;
  className?: string;
  onSuccess?: (state: Extract<ArchivoActionState, { status: "success" }>) => void;
}

export function SimpleForm({ action, children, submitLabel, pendingLabel, submitClassName, submitDisabled, className, onSuccess }: SimpleFormProps) {
  const [state, formAction] = useActionState(action, IDLE_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onSuccess?.(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} noValidate className={className}>
      {children}
      {state.status === "error" ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" && state.message ? <p className="mt-2 text-sm text-emerald-600">{state.message}</p> : null}
      <div className="mt-3">
        <SubmitButton label={submitLabel} pendingLabel={pendingLabel ?? "Enviando…"} className={submitClassName} disabled={submitDisabled} />
      </div>
    </form>
  );
}
