"use client";

/** `/cuenta` (M02, FASE 2 point 2.4) -- change your own password. */
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { cambiarPasswordAction, type CambiarPasswordFormState } from "./actions";

const initialState: CambiarPasswordFormState = { message: null, success: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
    >
      {pending ? "Guardando…" : "Cambiar contraseña"}
    </button>
  );
}

export default function CuentaPage() {
  const [state, formAction] = useActionState(cambiarPasswordAction, initialState);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.message) {
      messageRef.current?.focus();
      if (state.success) {
        formRef.current?.reset();
      }
    }
  }, [state.message, state.success]);

  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <h1 className="mb-6 text-xl font-semibold">Mi cuenta</h1>
      <h2 className="mb-4 text-lg font-medium">Cambiar contraseña</h2>

      <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="actual" className="text-sm font-medium">
            Contraseña actual
          </label>
          <input
            id="actual"
            name="actual"
            type="password"
            required
            autoComplete="current-password"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="nueva" className="text-sm font-medium">
            Nueva contraseña
          </label>
          <input
            id="nueva"
            name="nueva"
            type="password"
            required
            autoComplete="new-password"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="nuevaRepeat" className="text-sm font-medium">
            Repetir nueva contraseña
          </label>
          <input
            id="nuevaRepeat"
            name="nuevaRepeat"
            type="password"
            required
            autoComplete="new-password"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        {state.message ? (
          <p
            ref={messageRef}
            role={state.success ? "status" : "alert"}
            tabIndex={-1}
            className={`text-sm outline-none ${state.success ? "text-green-700 dark:text-green-400" : "text-red-600"}`}
          >
            {state.message}
          </p>
        ) : null}

        <SubmitButton />
      </form>
    </div>
  );
}
