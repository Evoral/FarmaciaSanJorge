"use client";

/**
 * Generic wrapper for every sensitive admin Server Action in this module
 * (designar/cesar, both requiring recent re-authentication -- see
 * `modules/directores-tecnicos/application/{designar-director-tecnico,cesar-designacion}.ts`).
 * Own small copy of `modules/usuarios/ui/reauth-aware-form.tsx` -- that
 * component is typed to `UsuarioActionState` from a sibling module's
 * `ui/`, which this task must not import from (module boundary; task
 * instruction: "Build your OWN small copies ... do not import the
 * usuarios one"). Renders `children` (the form's own fields) inside a
 * `<form action={formAction}>`, shows the action's error message with
 * `role="alert"`, and catches a `{ status: "reauth-required" }` result
 * (./action-state.ts) by showing `modules/auth/ui/reauth-prompt.tsx` and,
 * once re-authentication succeeds, RESUBMITTING THE SAME FORM (via
 * `formRef.current.requestSubmit()`, which reads the fields already
 * present in the DOM -- nothing needs to be re-entered).
 */
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import type { DtActionState } from "./action-state";
import { IDLE_STATE } from "./action-state";

function SubmitButton({ label, pendingLabel, className }: { label: string; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className ?? "btn btn-primary"}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export interface ReauthAwareFormProps {
  action: (prevState: DtActionState, formData: FormData) => Promise<DtActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  /** Called after a successful submit, in addition to `router.refresh()` (which always runs on success so the server-rendered page reflects the change). */
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
