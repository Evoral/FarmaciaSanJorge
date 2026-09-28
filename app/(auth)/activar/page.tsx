"use client";

/** `/activar` (M02, FASE 2 point 2.3). Public path (see proxy.ts). */
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { activarAction, type ActivarFormState } from "./actions";
import { NewPasswordFields } from "@/modules/auth/ui/new-password-fields";

const initialState: ActivarFormState = { message: null, success: false };

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full btn btn-primary"
    >
      {pending ? "Activando…" : "Activar cuenta"}
    </button>
  );
}

export default function ActivarPage() {
  const [state, formAction] = useActionState(activarAction, initialState);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Controlled so a rejected activation (wrong code, expired, ...) keeps what the user typed.
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [passwordValid, setPasswordValid] = useState(false);

  useEffect(() => {
    if (state.message) {
      (state.success ? headingRef : messageRef).current?.focus();
    }
  }, [state]);

  const canSubmit = email.trim().length > 0 && codigo.trim().length > 0 && passwordValid;

  if (state.success) {
    // Replaces the whole form view -- the activation instructions would only confuse at this point.
    return (
      <main className="flex flex-col items-center text-center">
        <span className="mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950">
          <CircleCheck aria-hidden className="size-9 text-emerald-600 dark:text-emerald-400" />
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="mb-2 text-3xl font-semibold outline-none">
          Cuenta activada
        </h1>
        <p role="status" className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Ya podés iniciar sesión.
        </p>
        <Link href="/login" className="w-full btn btn-primary">
          Ir a iniciar sesión
        </Link>
      </main>
    );
  }

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold">Activar cuenta</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Ingresá el email y el código que te dio el administrador, y elegí tu contraseña. El código vence a las
        72 horas de haber sido emitido.
      </p>

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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
            value={codigo}
            onChange={(event) => setCodigo(event.target.value)}
            className="input"
          />
        </div>

        <NewPasswordFields name="password" repeatName="passwordRepeat" onValidityChange={setPasswordValid} />

        {state.message ? (
          <p ref={messageRef} role="alert" tabIndex={-1} className="text-sm text-red-600 outline-none">
            {state.message}
          </p>
        ) : null}

        <SubmitButton disabled={!canSubmit} />
      </form>
    </main>
  );
}
