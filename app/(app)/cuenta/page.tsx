"use client";

/**
 * `/cuenta` (M02, FASE 2 point 2.4 -- change your own password; PIN
 * section added by the PIN re-auth feature, user decision 2026-09-23).
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { cambiarPasswordAction, configurarPinAction, eliminarPinAction, type CambiarPasswordFormState, type PinFormState } from "./actions";
import { NewPasswordFields } from "@/modules/auth/ui/new-password-fields";

const initialState: CambiarPasswordFormState = { message: null, success: false };
const initialPinState: PinFormState = { message: null, success: false };

function SubmitButton({ label, pendingLabel, className, disabled = false }: { label: string; pendingLabel?: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={className ?? "w-full btn btn-primary"}
    >
      {pending ? (pendingLabel ?? "Guardando…") : label}
    </button>
  );
}

function PinSection() {
  const [configurarState, configurarFormAction] = useActionState(configurarPinAction, initialPinState);
  const [eliminarState, eliminarFormAction] = useActionState(eliminarPinAction, initialPinState);
  const configurarMessageRef = useRef<HTMLParagraphElement>(null);
  const configurarFormRef = useRef<HTMLFormElement>(null);
  const eliminarMessageRef = useRef<HTMLParagraphElement>(null);
  const eliminarFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (configurarState.message) {
      configurarMessageRef.current?.focus();
      if (configurarState.success) configurarFormRef.current?.reset();
    }
  }, [configurarState.message, configurarState.success]);

  useEffect(() => {
    if (eliminarState.message) {
      eliminarMessageRef.current?.focus();
      if (eliminarState.success) eliminarFormRef.current?.reset();
    }
  }, [eliminarState.message, eliminarState.success]);

  return (
    <div className="mt-10">
      <h2 className="mb-1 text-lg font-medium">PIN de reautenticación rápida</h2>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Un PIN de 6 dígitos para confirmar acciones sensibles sin escribir tu contraseña completa. Nunca sirve para iniciar sesión.
      </p>

      <form ref={configurarFormRef} action={configurarFormAction} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="passwordActual" className="text-sm font-medium">
            Contraseña actual
          </label>
          <input
            id="passwordActual"
            name="passwordActual"
            type="password"
            required
            autoComplete="current-password"
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="pin" className="text-sm font-medium">
            Nuevo PIN (6 dígitos)
          </label>
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoComplete="off"
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="pinRepeat" className="text-sm font-medium">
            Repetir PIN
          </label>
          <input
            id="pinRepeat"
            name="pinRepeat"
            type="password"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoComplete="off"
            className="input"
          />
        </div>

        {configurarState.message ? (
          <p
            ref={configurarMessageRef}
            role={configurarState.success ? "status" : "alert"}
            tabIndex={-1}
            className={`text-sm outline-none ${configurarState.success ? "text-green-700 dark:text-green-400" : "text-red-600"}`}
          >
            {configurarState.message}
          </p>
        ) : null}

        <SubmitButton label="Guardar PIN" />
      </form>

      <form ref={eliminarFormRef} action={eliminarFormAction} noValidate className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="passwordActualEliminar" className="text-sm font-medium">
            Contraseña actual (para eliminar el PIN)
          </label>
          <input
            id="passwordActualEliminar"
            name="passwordActualEliminar"
            type="password"
            required
            autoComplete="current-password"
            className="input"
          />
        </div>

        {eliminarState.message ? (
          <p
            ref={eliminarMessageRef}
            role={eliminarState.success ? "status" : "alert"}
            tabIndex={-1}
            className={`text-sm outline-none ${eliminarState.success ? "text-green-700 dark:text-green-400" : "text-red-600"}`}
          >
            {eliminarState.message}
          </p>
        ) : null}

        <SubmitButton label="Eliminar PIN" className="btn btn-danger w-full" />
      </form>
    </div>
  );
}

export default function CuentaPage() {
  // Controlled fields (NewPasswordFields too) so a rejected change keeps what the user typed; cleared only on success.
  const [actual, setActual] = useState("");
  const [fieldsKey, setFieldsKey] = useState(0);
  const [passwordValid, setPasswordValid] = useState(false);
  const [state, formAction] = useActionState(async (prevState: CambiarPasswordFormState, formData: FormData) => {
    const result = await cambiarPasswordAction(prevState, formData);
    if (result.success) {
      setActual("");
      setFieldsKey((key) => key + 1);
    }
    return result;
  }, initialState);
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.message) {
      messageRef.current?.focus();
    }
  }, [state]);

  return (
    <div className="page max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">Mi cuenta</h1>
      <h2 className="mb-4 text-lg font-medium">Cambiar contraseña</h2>

      <form action={formAction} noValidate className="flex flex-col gap-4">
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
            value={actual}
            onChange={(event) => setActual(event.target.value)}
            className="input"
          />
        </div>

        <NewPasswordFields
          key={fieldsKey}
          name="nueva"
          repeatName="nuevaRepeat"
          repeatLabel="Repetir nueva contraseña"
          onValidityChange={setPasswordValid}
        />

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

        <SubmitButton label="Cambiar contraseña" disabled={actual.length === 0 || !passwordValid} />
      </form>

      <PinSection />
    </div>
  );
}
