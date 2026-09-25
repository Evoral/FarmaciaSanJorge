"use client";

/**
 * `/login` (M02, FASE 2 point 2.2). Public path (see proxy.ts's
 * PUBLIC_PATHS). No tenant selector (DP-40 RESUELTA): email + password
 * only.
 */
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = { message: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full btn btn-primary"
    >
      {pending ? "Ingresando…" : "Ingresar"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState(loginAction, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.message) {
      errorRef.current?.focus();
    }
  }, [state.message]);

  return (
    <main>
      <h1 className="mb-6 text-2xl font-semibold">Iniciar sesión</h1>

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
          <label htmlFor="password" className="text-sm font-medium">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input"
          />
        </div>

        {state.message ? (
          <p ref={errorRef} role="alert" tabIndex={-1} className="text-sm text-red-600 outline-none">
            {state.message}
          </p>
        ) : null}

        <SubmitButton />
      </form>

      <p className="mt-6 text-xs leading-relaxed text-zinc-500">
        ¿No podés ingresar o te olvidaste la contraseña? Contactá al administrador de tu farmacia: no hay
        autoregistro ni recuperación automática de contraseña.
      </p>
    </main>
  );
}
