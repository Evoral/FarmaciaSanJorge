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
      <div role="alert" className="rounded border-2 border-amber-500 bg-amber-50 p-4 dark:bg-amber-950">
        <p className="mb-2 font-semibold text-amber-900 dark:text-amber-200">Nueva credencial — se muestra una sola vez</p>
        <p className="mb-3 text-sm text-amber-900 dark:text-amber-200">
          Entregásela en mano. Vence el {new Date(state.credencialVenceEn!).toLocaleString("es-AR")} (72 horas). El usuario pasó a
          &quot;Pendiente de activación&quot; y se cerraron sus sesiones y credenciales anteriores.
        </p>
        <code className="block break-all rounded bg-white px-3 py-2 text-sm dark:bg-zinc-900">{state.credencial}</code>
        <p className="mt-3 text-sm text-amber-900 dark:text-amber-200">
          No es una contraseña: la persona lo ingresa junto con su email en <span className="font-mono">/activar</span> (link
          &quot;Activá tu cuenta&quot; en la pantalla de inicio de sesión) para elegir una contraseña nueva.
        </p>
      </div>
    );
  }

  return (
    <>
      <form action={formAction} onSubmit={onSubmit}>
        <input type="hidden" name="usuarioId" value={usuarioId} />
        {state.status === "error" ? (
          <p role="alert" className="mb-2 text-sm text-red-600">
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
