"use client";

/** Minimal Server Action form wrapper for non-reauth actions (iniciar/descartar/generar etiqueta) -- own copy per module, see modules/elaboracion/ui/simple-form.tsx for the shared shape. */
import { useActionState, useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { PreparacionActionState } from "./action-state";
import { IDLE_STATE } from "./action-state";

function SubmitButton({ label, pendingLabel, className }: { label: string; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className ?? "rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export interface SimpleFormProps {
  action: (prevState: PreparacionActionState, formData: FormData) => Promise<PreparacionActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  className?: string;
  onSuccess?: (state: Extract<PreparacionActionState, { status: "success" }>) => void;
}

export function SimpleForm({ action, children, submitLabel, pendingLabel, submitClassName, className, onSuccess }: SimpleFormProps) {
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
        <SubmitButton label={submitLabel} pendingLabel={pendingLabel ?? "Guardando…"} className={submitClassName} />
      </div>
    </form>
  );
}
