"use client";

/**
 * Generic wrapper for `anularAsientoAction` (INV-X02, step-up). Own small
 * copy of `modules/preparaciones/ui/reauth-aware-form.tsx` -- module
 * boundary convention: this module must not import a sibling module's own
 * form-wrapper `ui/`. Catches `{ status: "reauth-required" }` and shows
 * `modules/auth/ui/reauth-prompt.tsx`, resubmitting the SAME form on
 * success (nothing needs to be re-typed, including the DT co-firma
 * fields).
 */
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import type { LibroActionState } from "./action-state";
import { IDLE_STATE } from "./action-state";

function SubmitButton({ label, pendingLabel, className, disabled }: { label: string; pendingLabel: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className ?? "rounded bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50"}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export interface ReauthAwareFormProps {
  action: (prevState: LibroActionState, formData: FormData) => Promise<LibroActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  submitDisabled?: boolean;
  onSuccess?: () => void;
  className?: string;
}

export function ReauthAwareForm({ action, children, submitLabel, pendingLabel, submitClassName, submitDisabled, onSuccess, className }: ReauthAwareFormProps) {
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
        {state.status === "success" && state.message ? <p className="mt-2 text-sm text-emerald-600">{state.message}</p> : null}
        <div className="mt-4">
          <SubmitButton label={submitLabel} pendingLabel={pendingLabel ?? "Enviando…"} className={submitClassName} disabled={submitDisabled} />
        </div>
      </form>

      {state.status === "reauth-required" ? (
        <ReauthPrompt onReauthenticated={() => formRef.current?.requestSubmit()} onCancel={() => undefined} />
      ) : null}
    </>
  );
}
