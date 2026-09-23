"use client";

/**
 * Generic wrapper for `/admin/farmacia`'s sensitive edit action (FASE 3
 * point 3.10a -- editing institutional data requires recent
 * re-authentication). Own copy of modules/usuarios/ui/reauth-aware-form.tsx
 * (task instruction: do not import the usuarios-typed one) -- same shape,
 * same `modules/auth/ui/reauth-prompt.tsx` reuse. See that file's doc
 * comment for the full rationale.
 */
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import type { FarmaciaActionState } from "./action-state";
import { IDLE_STATE } from "./action-state";

function SubmitButton({ label, pendingLabel, className }: { label: string; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className ?? "rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export interface ReauthAwareFormProps {
  action: (prevState: FarmaciaActionState, formData: FormData) => Promise<FarmaciaActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  onSuccess?: () => void;
  className?: string;
}

export function ReauthAwareForm({ action, children, submitLabel, pendingLabel, submitClassName, onSuccess, className }: ReauthAwareFormProps) {
  const [state, formAction] = useActionState(action, IDLE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <>
      <form ref={formRef} action={formAction} noValidate className={className}>
        {children}
        {state.status === "error" ? (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {state.message}
          </p>
        ) : null}
        <div className="mt-3">
          <SubmitButton label={submitLabel} pendingLabel={pendingLabel ?? "Guardando…"} className={submitClassName} />
        </div>
      </form>

      {state.status === "reauth-required" ? (
        <ReauthPrompt onReauthenticated={() => formRef.current?.requestSubmit()} onCancel={() => undefined} />
      ) : null}
    </>
  );
}
