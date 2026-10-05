"use client";

/**
 * `/admin/accesos/usuarios/[id]` "Restablecer credencial" action (M03, FASE 3
 * point 3.6, INV-U08). Same one-time-display discipline as the creation
 * flow (`app/(app)/admin/accesos/usuarios/nuevo/page.tsx`): the credential is
 * shown inline, exactly once, with an explicit expiry/one-shot notice, and
 * is never put in a URL.
 *
 * Re-authentication retry: `resubmit()` from
 * `modules/auth/ui/use-reauth-form-submit.ts` re-dispatches the FormData
 * captured on the original submit (React 19 auto-resets a `<form action>`
 * on every submit, so re-reading the DOM with `requestSubmit()` would
 * send an already-reset form).
 */
import { useActionState } from "react";
import { restablecerCredencialAction } from "./actions";
import type { RestablecerCredencialState } from "./actions";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import { useReauthFormSubmit } from "@/modules/auth/ui/use-reauth-form-submit";
import { CredencialActivacion } from "./credencial-activacion";

const initialState: RestablecerCredencialState = { status: "idle" };

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className="btn btn-secondary">
      {pending ? "Restableciendo…" : "Restablecer credencial"}
    </button>
  );
}

export function RestablecerCredencial({ usuarioId }: { usuarioId: string }) {
  const [state, formAction, isPending] = useActionState(restablecerCredencialAction, initialState);
  const { onSubmit, resubmit } = useReauthFormSubmit(formAction);

  // Deliberately no router.refresh() on success: the credential must stay
  // visible on screen. The estado badge above will be stale until the
  // next navigation -- acceptable, since this action's own confirmation
  // already states the new estado.

  if (state.status === "success" && state.credencial) {
    return (
      <CredencialActivacion titulo="Nueva credencial: se muestra una sola vez" credencial={state.credencial} venceEn={state.credencialVenceEn!}>
        Entregásela en mano. El usuario pasó a «Pendiente de activación» y se cerraron sus sesiones y credenciales anteriores.
      </CredencialActivacion>
    );
  }

  return (
    <>
      <form action={formAction} onSubmit={onSubmit}>
        <input type="hidden" name="usuarioId" value={usuarioId} />
        {state.status === "error" ? (
          <p role="alert" className="alert alert-danger mb-3">
            {state.message}
          </p>
        ) : null}
        <SubmitButton pending={isPending} />
      </form>
      {state.status === "reauth-required" ? (
        <ReauthPrompt onReauthenticated={resubmit} onCancel={() => undefined} />
      ) : null}
    </>
  );
}
