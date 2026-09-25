"use client";

/**
 * `/admin/usuarios/[id]` "Restablecer credencial" action (M03, FASE 3
 * point 3.6, INV-U08). Same one-time-display discipline as the creation
 * flow (`app/(app)/admin/usuarios/nuevo/page.tsx`): the credential is
 * shown inline, exactly once, with an explicit expiry/one-shot notice, and
 * is never put in a URL.
 */
import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import { restablecerCredencialAction } from "./actions";
import type { RestablecerCredencialState } from "./actions";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";

const initialState: RestablecerCredencialState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-secondary">
      {pending ? "Restableciendo…" : "Restablecer credencial"}
    </button>
  );
}

export function RestablecerCredencial({ usuarioId }: { usuarioId: string }) {
  const [state, formAction] = useActionState(restablecerCredencialAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

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
      </div>
    );
  }

  return (
    <>
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="usuarioId" value={usuarioId} />
        {state.status === "error" ? (
          <p role="alert" className="mb-2 text-sm text-red-600">
            {state.message}
          </p>
        ) : null}
        <SubmitButton />
      </form>
      {state.status === "reauth-required" ? (
        <ReauthPrompt onReauthenticated={() => formRef.current?.requestSubmit()} onCancel={() => undefined} />
      ) : null}
    </>
  );
}
