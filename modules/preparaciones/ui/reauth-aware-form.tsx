"use client";

/**
 * Generic wrapper for `confirmarPreparacionAction` (INV-X02, step-up). Own
 * small copy of `modules/directores-tecnicos/ui/reauth-aware-form.tsx` --
 * module boundary: this module must not import a sibling module's `ui/`.
 * Renders `children` inside a `<form action={formAction}>`, shows the
 * action's error message with `role="alert"`, and catches a
 * `{ status: "reauth-required" }` result by showing
 * `modules/auth/ui/reauth-prompt.tsx` and, once re-authentication succeeds,
 * RESUBMITTING THE SAME FORM (`formRef.current.requestSubmit()` -- nothing
 * needs to be re-entered, including every partida checkbox).
 */
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import type { PreparacionActionState } from "./action-state";
import { IDLE_STATE } from "./action-state";

function SubmitButton({ label, pendingLabel, className, disabled }: { label: string; pendingLabel: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className ?? "btn btn-primary"}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export interface ReauthAwareFormProps {
  action: (prevState: PreparacionActionState, formData: FormData) => Promise<PreparacionActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  submitDisabled?: boolean;
  onSuccess?: (state: Extract<PreparacionActionState, { status: "success" }>) => void;
  className?: string;
}

export function ReauthAwareForm({ action, children, submitLabel, pendingLabel, submitClassName, submitDisabled, onSuccess, className }: ReauthAwareFormProps) {
  const [state, formAction] = useActionState(action, IDLE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onSuccess?.(state);
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
          <SubmitButton label={submitLabel} pendingLabel={pendingLabel ?? "Confirmando…"} className={submitClassName} disabled={submitDisabled} />
        </div>
      </form>

      {state.status === "reauth-required" ? (
        <ReauthPrompt onReauthenticated={() => formRef.current?.requestSubmit()} onCancel={() => undefined} />
      ) : null}
    </>
  );
}
