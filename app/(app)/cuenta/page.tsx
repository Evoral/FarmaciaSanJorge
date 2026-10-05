"use client";

/**
 * `/cuenta` (M02, FASE 2 point 2.4 -- change your own password; PIN
 * section added by the PIN re-auth feature, user decision 2026-09-23).
 *
 * All three forms submit through `shared/ui/use-form-submit.ts` (bypasses
 * React 19's automatic form reset), so a rejected submit keeps everything
 * the user typed -- password/PIN fields included, consistent with the
 * existing "cleared only on success" design below; each form is cleared
 * explicitly on success only.
 *
 * Layout: two panels (contraseña | PIN) side by side on wide screens; removing
 * the PIN sits in its own danger zone inside the PIN panel.
 */
import { useActionState, useEffect, useRef, useState, type RefObject } from "react";
import { CircleAlert, CircleCheck, KeyRound, ShieldCheck } from "lucide-react";
import { cambiarPasswordAction, configurarPinAction, eliminarPinAction, type CambiarPasswordFormState, type PinFormState } from "./actions";
import { NewPasswordFields } from "@/modules/auth/ui/new-password-fields";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { PageHeader } from "@/shared/ui/page-header";

const initialState: CambiarPasswordFormState = { message: null, success: false };
const initialPinState: PinFormState = { message: null, success: false };

function SubmitButton({ label, pendingLabel, pending, className, disabled = false }: { label: string; pendingLabel?: string; pending: boolean; className?: string; disabled?: boolean }) {
  return (
    <button type="submit" disabled={pending || disabled} className={className ?? "btn btn-primary"}>
      {pending ? <span className="spinner" aria-hidden /> : null}
      {pending ? (pendingLabel ?? "Guardando…") : label}
    </button>
  );
}

/** Result of a form: focusable so the effects below can move focus to it. */
function Mensaje({ state, messageRef }: { state: { message: string | null; success: boolean }; messageRef: RefObject<HTMLParagraphElement | null> }) {
  if (!state.message) return null;
  return (
    <p ref={messageRef} role={state.success ? "status" : "alert"} tabIndex={-1} className={`alert outline-none ${state.success ? "alert-success" : "alert-danger"}`}>
      {state.success ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
      <span>{state.message}</span>
    </p>
  );
}

function PinSection() {
  const [configurarState, configurarFormAction, configurarPending] = useActionState(configurarPinAction, initialPinState);
  const [eliminarState, eliminarFormAction, eliminarPending] = useActionState(eliminarPinAction, initialPinState);
  const { onSubmit: onConfigurarSubmit } = useFormSubmit(configurarFormAction);
  const { onSubmit: onEliminarSubmit } = useFormSubmit(eliminarFormAction);
  const configurarMessageRef = useRef<HTMLParagraphElement>(null);
  const configurarFormRef = useRef<HTMLFormElement>(null);
  const eliminarMessageRef = useRef<HTMLParagraphElement>(null);
  const eliminarFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (configurarState.message) {
      configurarMessageRef.current?.focus();
      if (configurarState.success) configurarFormRef.current?.reset();
    }
  }, [configurarState]);

  useEffect(() => {
    if (eliminarState.message) {
      eliminarMessageRef.current?.focus();
      if (eliminarState.success) eliminarFormRef.current?.reset();
    }
  }, [eliminarState]);

  return (
    <section className="panel" aria-labelledby="pin-heading">
      <div className="panel-header flex items-start gap-3">
        <span className="tone-tile" aria-hidden>
          <ShieldCheck />
        </span>
        <div>
          <h2 id="pin-heading">PIN de reautenticación rápida</h2>
          <p>Un PIN de 6 dígitos para confirmar acciones sensibles sin escribir tu contraseña completa. Nunca sirve para iniciar sesión.</p>
        </div>
      </div>

      <div className="panel-body flex flex-col gap-6">
        <form ref={configurarFormRef} action={configurarFormAction} onSubmit={onConfigurarSubmit} noValidate className="flex flex-col gap-4">
          <div className="field">
            <label htmlFor="passwordActual" className="field-label">
              Contraseña actual
            </label>
            <input id="passwordActual" name="passwordActual" type="password" required autoComplete="current-password" className="input" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="pin" className="field-label">
                Nuevo PIN <span className="font-normal text-zinc-500">(6 dígitos)</span>
              </label>
              <input id="pin" name="pin" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="off" className="input font-mono tracking-[0.3em]" />
            </div>

            <div className="field">
              <label htmlFor="pinRepeat" className="field-label">
                Repetir PIN
              </label>
              <input id="pinRepeat" name="pinRepeat" type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="off" className="input font-mono tracking-[0.3em]" />
            </div>
          </div>

          <Mensaje state={configurarState} messageRef={configurarMessageRef} />

          <div>
            <SubmitButton label="Guardar PIN" pending={configurarPending} />
          </div>
        </form>

        <form
          ref={eliminarFormRef}
          action={eliminarFormAction}
          onSubmit={onEliminarSubmit}
          noValidate
          className="subpanel flex flex-col gap-3 border-red-200 bg-red-50/40"
          aria-labelledby="eliminar-pin-heading"
        >
          <div>
            <h3 id="eliminar-pin-heading" className="text-[0.8125rem] font-semibold text-red-800">
              Eliminar el PIN
            </h3>
            <p className="mt-0.5 text-xs text-zinc-600">Las acciones sensibles vuelven a pedir tu contraseña completa.</p>
          </div>
          <div className="field">
            <label htmlFor="passwordActualEliminar" className="field-label">
              Contraseña actual
            </label>
            <input id="passwordActualEliminar" name="passwordActualEliminar" type="password" required autoComplete="current-password" className="input" />
          </div>

          <Mensaje state={eliminarState} messageRef={eliminarMessageRef} />

          <div>
            <SubmitButton label="Eliminar PIN" pending={eliminarPending} className="btn btn-danger" />
          </div>
        </form>
      </div>
    </section>
  );
}

export default function CuentaPage() {
  // Controlled fields (NewPasswordFields too) so a rejected change keeps what the user typed; cleared only on success.
  const [actual, setActual] = useState("");
  const [fieldsKey, setFieldsKey] = useState(0);
  const [passwordValid, setPasswordValid] = useState(false);
  const [state, formAction, isPending] = useActionState(async (prevState: CambiarPasswordFormState, formData: FormData) => {
    const result = await cambiarPasswordAction(prevState, formData);
    if (result.success) {
      setActual("");
      setFieldsKey((key) => key + 1);
    }
    return result;
  }, initialState);
  const { onSubmit } = useFormSubmit(formAction);
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.message) {
      messageRef.current?.focus();
    }
  }, [state]);

  return (
    <div className="page">
      <PageHeader breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Mi cuenta" }]} title="Mi cuenta" description="Tu contraseña y tu PIN para confirmar acciones." />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="panel" aria-labelledby="password-heading">
          <div className="panel-header flex items-start gap-3">
            <span className="tone-tile" aria-hidden>
              <KeyRound />
            </span>
            <div>
              <h2 id="password-heading">Cambiar contraseña</h2>
              <p>Tiene que cumplir los requisitos que se muestran abajo.</p>
            </div>
          </div>

          <form action={formAction} onSubmit={onSubmit} noValidate className="panel-body flex flex-col gap-4">
            <div className="field">
              <label htmlFor="actual" className="field-label">
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

            <NewPasswordFields key={fieldsKey} name="nueva" repeatName="nuevaRepeat" repeatLabel="Repetir nueva contraseña" onValidityChange={setPasswordValid} />

            <Mensaje state={state} messageRef={messageRef} />

            <div>
              <SubmitButton label="Cambiar contraseña" pending={isPending} disabled={actual.length === 0 || !passwordValid} />
            </div>
          </form>
        </section>

        <PinSection />
      </div>
    </div>
  );
}
