"use client";

/** `/activar` (M02, FASE 2 point 2.3). Public path (see proxy.ts). */
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { activarAction, type ActivarFormState } from "./actions";

const initialState: ActivarFormState = { message: null, success: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full btn btn-primary"
    >
      {pending ? "Activando…" : "Activar cuenta"}
    </button>
  );
}

export default function ActivarPage() {
  const [state, formAction] = useActionState(activarAction, initialState);
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.message) {
      messageRef.current?.focus();
    }
  }, [state.message]);

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold">Activar cuenta</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Ingresá el email y el código que te dio el administrador, y elegí tu contraseña. El código vence a las
        72 horas de haber sido emitido.
      </p>

      {state.success ? (
        <p ref={messageRef} role="status" tabIndex={-1} className="text-sm text-green-700 outline-none dark:text-green-400">
          {state.message}{" "}
          <a href="/login" className="underline">
            Ir a iniciar sesión
          </a>
        </p>
      ) : (
        <form action={formAction} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              className="input"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="codigo" className="text-sm font-medium">
              Código de activación
            </label>
            <input
              id="codigo"
              name="codigo"
              type="text"
              required
              autoComplete="one-time-code"
              className="input"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium">
              Nueva contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              className="input"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="passwordRepeat" className="text-sm font-medium">
              Repetir contraseña
            </label>
            <input
              id="passwordRepeat"
              name="passwordRepeat"
              type="password"
              required
              autoComplete="new-password"
              className="input"
            />
          </div>

          {state.message ? (
            <p ref={messageRef} role="alert" tabIndex={-1} className="text-sm text-red-600 outline-none">
              {state.message}
            </p>
          ) : null}

          <SubmitButton />
        </form>
      )}
    </main>
  );
}
