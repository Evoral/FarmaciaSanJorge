"use client";

/**
 * Generic wrapper for every sensitive admin Server Action in this module
 * (M03, FASE 3, task's binding decision: "reset credential, suspend, BAJA,
 * role changes require recent re-authentication"). Renders `children`
 * (the form's own fields) inside a `<form action={formAction}>`, shows the
 * action's error message with `role="alert"`, and -- the reason this
 * exists instead of every call site repeating the same boilerplate --
 * catches a `{ status: "reauth-required" }` result (see
 * `./action-state.ts`) by showing `modules/auth/ui/reauth-prompt.tsx` and,
 * once re-authentication succeeds, RESUBMITTING THE SAME FORM (via
 * `formRef.current.requestSubmit()`, which reads the fields already
 * present in the DOM -- nothing needs to be re-entered).
 */
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import type { UsuarioActionState } from "./action-state";
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
  action: (prevState: UsuarioActionState, formData: FormData) => Promise<UsuarioActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  /** Called after a successful submit, in addition to `router.refresh()` (which always runs on success so the server-rendered detail page reflects the change). */
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
