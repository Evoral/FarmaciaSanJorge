"use client";

/**
 * Step 1 of docs/specs/contrasena-temporal.md: the usuario replaces the temporary
 * password an administrator set. Submits through `useFormSubmit` so a rejected
 * password (too weak, same as the temporary one...) keeps what was typed.
 */
import { useActionState, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { cambiarPasswordTemporalAction } from "./actions";
import { NewPasswordFields } from "@/modules/auth/ui/new-password-fields";
import { errorFieldsOf, type FormActionState } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

const initialState: FormActionState = { status: "idle" };

export function CambiarPasswordForm() {
  const [state, formAction, isPending] = useActionState(cambiarPasswordTemporalAction, initialState);
  const { onSubmit } = useFormSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const [passwordValid, setPasswordValid] = useState(false);
  useFieldErrors(formRef, errorFieldsOf(state));

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold">Elegí tu contraseña</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Entraste con una contraseña temporal que te dio el administrador. Antes de seguir, elegí una propia que sólo vos conozcas.
      </p>

      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <NewPasswordFields name="nueva" repeatName="nuevaRepeat" onValidityChange={setPasswordValid} />

        {state.status === "error" ? (
          <p role="alert" className="alert alert-danger">
            <CircleAlert aria-hidden />
            <span>{state.message}</span>
          </p>
        ) : null}

        <button type="submit" disabled={isPending || !passwordValid} className="w-full btn btn-primary">
          {isPending ? "Guardando…" : "Guardar contraseña"}
        </button>
      </form>
    </main>
  );
}
