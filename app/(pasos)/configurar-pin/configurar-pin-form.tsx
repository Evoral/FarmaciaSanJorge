"use client";

/**
 * Step 2 of openspec/specs/contrasena-temporal/spec.md: the usuario sets the PIN they will
 * use to confirm acciones. Same inputs as `/cuenta`'s PIN panel, without the
 * current-password field (it was just set in step 1). Submits through
 * `useFormSubmit` so a rejected PIN keeps what was typed.
 */
import { useActionState, useRef } from "react";
import { CircleAlert } from "lucide-react";
import { configurarPinObligatorioAction } from "./actions";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { errorFieldsOf, type FormActionState } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

const initialState: FormActionState = { status: "idle" };

export function ConfigurarPinForm() {
  const [state, formAction, isPending] = useActionState(configurarPinObligatorioAction, initialState);
  const { onSubmit } = useFormSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  useFieldErrors(formRef, errorFieldsOf(state));

  return (
    <main>
      <h1 className="mb-2 text-2xl font-semibold">Configurá tu PIN</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Es un PIN de {AUTH_POLICY.pinLength} dígitos para identificarte al confirmar acciones. Nunca sirve para iniciar sesión.
      </p>

      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="field">
          <label htmlFor="pin" className="field-label">
            PIN <span className="font-normal text-zinc-500">({AUTH_POLICY.pinLength} dígitos)</span>
          </label>
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern={`\\d{${AUTH_POLICY.pinLength}}`}
            maxLength={AUTH_POLICY.pinLength}
            required
            autoComplete="off"
            autoFocus
            className="input font-mono tracking-[0.3em]"
          />
        </div>

        <div className="field">
          <label htmlFor="pinRepeat" className="field-label">
            Repetir PIN
          </label>
          <input
            id="pinRepeat"
            name="pinRepeat"
            type="password"
            inputMode="numeric"
            pattern={`\\d{${AUTH_POLICY.pinLength}}`}
            maxLength={AUTH_POLICY.pinLength}
            required
            autoComplete="off"
            className="input font-mono tracking-[0.3em]"
          />
        </div>

        {state.status === "error" ? (
          <p role="alert" className="alert alert-danger">
            <CircleAlert aria-hidden />
            <span>{state.message}</span>
          </p>
        ) : null}

        <button type="submit" disabled={isPending} className="w-full btn btn-primary">
          {isPending ? "Guardando…" : "Guardar PIN"}
        </button>
      </form>
    </main>
  );
}
