"use client";

/**
 * Client forms of `/cuenta` (M02, FASE 2 point 2.4 -- change your own password;
 * PIN section added by the PIN re-auth feature, user decision 2026-09-23).
 *
 * Both forms submit through `shared/ui/use-form-submit.ts` (bypasses React 19's
 * automatic form reset), so a rejected submit keeps everything the user typed --
 * password/PIN fields included, consistent with the existing "cleared only on
 * success" design below; each form is cleared explicitly on success only.
 *
 * Layout: the panels (contraseña | PIN | huella) side by side when the container
 * is wide enough. The PIN and huella panels are hidden for cuentas de sector (they
 * hold none: the empleado does); the PIN cannot be deleted (it is mandatory for
 * every other usuario), the huella can. The huella panel only shows while the
 * farmacia has the huella enabled (openspec/changes/metodos-verificacion-operador).
 */
import { useActionState, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CircleAlert, CircleCheck, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import {
  cambiarPasswordAction,
  configurarPinAction,
  eliminarCredencialOperadorAction,
  registrarCredencialOperadorAction,
  type CambiarPasswordFormState,
  type CredencialOperadorFormState,
  type PinFormState,
} from "./actions";
import { NewPasswordFields } from "@/modules/auth/ui/new-password-fields";
import { NewPinFields } from "@/modules/auth/ui/new-pin-fields";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { HUELLA_LONGITUD_MINIMA } from "@/modules/auth/domain/verificacion-identidad";
import { CodigoLectorInput } from "@/shared/ui/codigo-lector-input";
import { clearRejectedField, useFieldErrors } from "@/shared/ui/field-errors";
import { CollapsibleActionCard } from "@/shared/ui/motivo-form";
import { toast } from "@/shared/ui/toast";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { PasswordInput } from "@/shared/ui/password-input";

const initialState: CambiarPasswordFormState = { message: null, success: false };
const initialPinState: PinFormState = { message: null, success: false };
const initialCredencialState: CredencialOperadorFormState = { message: null, success: false };

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
  const { onSubmit: onConfigurarSubmit } = useFormSubmit(configurarFormAction);
  const configurarMessageRef = useRef<HTMLParagraphElement>(null);
  const configurarFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (configurarState.message) {
      configurarMessageRef.current?.focus();
      if (configurarState.success) configurarFormRef.current?.reset();
    }
  }, [configurarState]);

  return (
    <section className="panel" aria-labelledby="pin-heading">
      <div className="panel-header flex items-start gap-3">
        <span className="tone-tile" aria-hidden>
          <ShieldCheck />
        </span>
        <div>
          <h2 id="pin-heading">PIN</h2>
          <p>Un PIN de {AUTH_POLICY.pinLength} dígitos para identificarte en las cuentas de sector (mostrador, laboratorio). Nunca sirve para iniciar sesión.</p>
        </div>
      </div>

      <div className="panel-body flex flex-col gap-6">
        <form ref={configurarFormRef} action={configurarFormAction} onSubmit={onConfigurarSubmit} noValidate className="@container flex flex-col gap-4">
          <div className="field">
            <label htmlFor="passwordActual" className="field-label">
              Contraseña actual
            </label>
            <PasswordInput id="passwordActual" name="passwordActual" required autoComplete="current-password" className="input" />
          </div>

          <div className="grid gap-4 @lg:grid-cols-2">
            <NewPinFields />
          </div>

          <Mensaje state={configurarState} messageRef={configurarMessageRef} />

          <div>
            <SubmitButton label="Guardar PIN" pending={configurarPending} />
          </div>
        </form>
      </div>
    </section>
  );
}

/**
 * «Huella» panel (openspec/changes/metodos-verificacion-operador): enrol, replace or remove the empleado's own huella.
 * The reader types the code into the field and presses Enter, which submits the form. The page only renders this panel
 * when the farmacia has the huella enabled and the session is an individual one.
 *
 * The code is never shown: the field is masked and the panel only says whether one is enrolled. A rejected submit keeps
 * the typed password and marks the field the error points at (`useFieldErrors`); a rejected huella code is emptied (the
 * reader's next scan must not append to it); success clears the form.
 */
function HuellaSection({ enrolada }: { enrolada: boolean }) {
  const [state, formAction, pending] = useActionState(registrarCredencialOperadorAction, initialCredencialState);
  const { onSubmit: onSubmitBase } = useFormSubmit(formAction);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // A reader that sends Enter twice fires two submits before React re-renders `pending`: the ref closes that gap.
  const enviando = useRef(false);

  // Reopened by the end of the transition (`pending` back to false) AND by any new result, so no path leaves the form stuck.
  useEffect(() => {
    if (!pending) enviando.current = false;
  }, [pending, state]);

  useEffect(() => {
    if (!state.message) return;
    messageRef.current?.focus();
    if (state.success) formRef.current?.reset();
    // A rejected code stays in the masked field and the reader's next scan would append to it: empty it (and focus it).
    else if (formRef.current) clearRejectedField(formRef.current, state.fields, "huella");
  }, [state]);
  // Declared after the message focus above, so a marked field ends up focused.
  useFieldErrors(formRef, state.fields);

  return (
    <section className="panel" aria-labelledby="huella-heading">
      <div className="panel-header flex items-start gap-3">
        <span className="tone-tile" aria-hidden>
          <Fingerprint />
        </span>
        <div>
          <h2 id="huella-heading">Huella</h2>
          <p>
            {enrolada ? "Tenés una huella enrolada." : "Todavía no enrolaste tu huella."} Pasala por el lector para identificarte en las cuentas de sector. Nunca sirve para iniciar
            sesión.
          </p>
        </div>
      </div>

      <div className="panel-body flex flex-col gap-6">
        <form
          ref={formRef}
          action={formAction}
          onSubmit={(event) => {
            if (enviando.current) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            enviando.current = true;
            onSubmitBase(event);
          }}
          noValidate
          className="@container flex flex-col gap-4"
        >
          <input type="hidden" name="metodo" value="HUELLA" />
          <div className="field">
            <label htmlFor="huellaPasswordActual" className="field-label">
              Contraseña actual
            </label>
            <PasswordInput id="huellaPasswordActual" name="passwordActual" required autoComplete="current-password" className="input" />
          </div>

          <div className="field">
            <label htmlFor="huellaCodigo" className="field-label">
              {enrolada ? "Nueva huella" : "Huella"} <span className="font-normal text-zinc-500">(al menos {HUELLA_LONGITUD_MINIMA} caracteres)</span>
            </label>
            {/* After the current-password field, never before it: a text field preceding a password field is what browsers take for its username. The PIN panel has no text field at all. */}
            <CodigoLectorInput id="huellaCodigo" name="huella" required aria-describedby="huellaCodigoAyuda" />
            <p id="huellaCodigoAyuda" className="text-[0.8125rem] text-zinc-600">
              Hacé clic acá y pasá el dedo por el lector: escribe el código y confirma con Enter.
            </p>
          </div>

          <Mensaje state={state} messageRef={messageRef} />

          <div>
            <SubmitButton label={enrolada ? "Reemplazar huella" : "Registrar huella"} pending={pending} />
          </div>
        </form>

        {enrolada ? <EliminarHuella /> : null}
      </div>
    </section>
  );
}

/** Removes the own huella behind a two-step card (same pattern as the admin actions). Always allowed, no password needed: it only reduces access. */
function EliminarHuella() {
  return (
    <CollapsibleActionCard label="Eliminar huella" helpText="Tu huella deja de identificarte. Podés enrolar otra cuando quieras. Tu PIN no cambia.">
      {({ close, cancelButton }) => <EliminarHuellaForm close={close} cancelButton={cancelButton} />}
    </CollapsibleActionCard>
  );
}

function EliminarHuellaForm({ close, cancelButton }: { close: () => void; cancelButton: ReactNode }) {
  const [state, formAction, pending] = useActionState(eliminarCredencialOperadorAction, initialCredencialState);
  const { onSubmit } = useFormSubmit(formAction);
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!state.message) return;
    if (state.success) {
      // The card unmounts with the panel's remove button once the page refreshes: a toast carries the confirmation.
      toast(state.message);
      close();
    } else messageRef.current?.focus();
  }, [state, close]);

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="metodo" value="HUELLA" />
      <Mensaje state={state} messageRef={messageRef} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton label="Eliminar huella" pendingLabel="Eliminando…" pending={pending} className="btn btn-danger" />
        {cancelButton}
      </div>
    </form>
  );
}

export interface CuentaFormsProps {
  mostrarPin: boolean;
  /** Present only when the huella panel applies: the huella is enabled in the farmacia and this is an individual, non-admin-only session. */
  huella?: { enrolada: boolean } | null;
}

export function CuentaForms({ mostrarPin, huella = null }: CuentaFormsProps) {
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
    // The container and the grid are two elements: a container query cannot style the element that is the container.
    // `@3xl` (48rem) is where the old viewport `lg:` landed once the sidebar is discounted; below it the panels stack.
    <div className="@container">
      <div className={`grid items-start gap-6${mostrarPin || huella ? " @3xl:grid-cols-2" : ""}`}>
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
              <PasswordInput
                id="actual"
                name="actual"
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

        {mostrarPin ? <PinSection /> : null}
        {huella ? <HuellaSection enrolada={huella.enrolada} /> : null}
      </div>
    </div>
  );
}
