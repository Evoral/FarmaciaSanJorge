"use client";

/**
 * Client form of `/admin/accesos/usuarios/nuevo` (M03, FASE 3 point 3.2); the
 * server page (`./page.tsx`) loads the tenant's assignable roles (DP-03:
 * per-tenant data) and passes them in as `roles`. The Administrador types a
 * temporary password (twice, with the live requirements checklist) -- for a
 * cuenta de sector it is the definitive one (full policy: it never changes
 * its own password, openspec/specs/cuentas-de-sector/spec.md); on
 * success the Server Action redirects to the new usuario's detail page, so
 * no secret is ever shown back nor put in a URL.
 *
 * M2 (security review): `status === "reauth-required"` (see `./actions.ts`)
 * shows `modules/auth/ui/reauth-prompt.tsx` and, once re-authentication
 * succeeds, resubmits the SAME data via `useReauthFormSubmit`'s
 * `resubmit()` (the FormData captured on the original submit) -- same
 * pattern as `modules/auth/ui/reauth-aware-form.tsx`, just inlined
 * here. It must NOT re-read the DOM (`requestSubmit()`): React 19 auto-resets a `<form action>` on
 * every submit, so the retry would send empty fields and no roles. See
 * `modules/auth/ui/use-reauth-form-submit.ts`. Because the hook's
 * `onSubmit` prevents that auto-reset, a failed submit also keeps what the
 * user typed. The error's `fields` are marked invalid
 * (`shared/ui/field-errors.ts`).
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { crearUsuarioAction, type CrearUsuarioFormState } from "./actions";
import { ReauthPrompt, useReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import { useReauthFormSubmit } from "@/modules/auth/ui/use-reauth-form-submit";
import { NewPasswordFields } from "@/modules/auth/ui/new-password-fields";
import { PASSWORD_REQUIREMENTS, TEMPORARY_PASSWORD_REQUIREMENTS } from "@/shared/auth/policy";
import { errorFieldsOf } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { PageHeader } from "@/shared/ui/page-header";

const initialCrearUsuarioState: CrearUsuarioFormState = { status: "idle", message: null };

const BREADCRUMBS = [{ label: "Inicio", href: "/" }, { label: "Usuarios y accesos" }, { label: "Usuarios", href: "/admin/accesos/usuarios" }];

function SubmitButton({ pending, disabled }: { pending: boolean; disabled: boolean }) {
  return (
    <button type="submit" disabled={pending || disabled} className="btn btn-primary">
      {pending ? <span className="spinner" aria-hidden /> : null}
      {pending ? "Creando…" : "Crear usuario"}
    </button>
  );
}

export function NuevoUsuarioForm({ roles }: { roles: readonly { codigo: string; nombre: string }[] }) {
  const [state, formAction, isPending] = useActionState(crearUsuarioAction, initialCrearUsuarioState);
  const reauth = useReauthPrompt(state);
  const { onSubmit, resubmit } = useReauthFormSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // A cuenta de sector (openspec/specs/cuentas-de-sector/spec.md) asks only for the sector's name and its login email.
  const [esSector, setEsSector] = useState(false);
  const [passwordValid, setPasswordValid] = useState(false);

  useEffect(() => {
    if (state.status === "error") {
      alertRef.current?.focus();
    }
  }, [state]);

  // After the effect above: when the error names fields, focus lands on the first of them (the alert is still announced).
  useFieldErrors(formRef, errorFieldsOf(state));

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumbs={[...BREADCRUMBS, { label: "Nuevo usuario" }]}
        title="Nuevo usuario"
        description={
          esSector
            ? "Queda activa con la contraseña que elijas, que no se cambia al ingresar ni pide PIN. Entregásela en mano al puesto: no hay envío automático."
            : "Queda activo con la contraseña temporal que elijas; tendrá que cambiarla y configurar su PIN al ingresar. Entregásela en mano: no hay envío automático."
        }
      />

      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="panel">
        <div className="panel-header">
          <h2>{esSector ? "Datos del sector" : "Datos de la persona"}</h2>
        </div>
        <div className="panel-body flex flex-col gap-5">
          {/* First: it decides which fields the form asks for (a sector is not a person -- no apellido, DNI nor matrícula). */}
          <label className="choice-row toggle-switch items-start">
            <input type="checkbox" role="switch" name="esSector" checked={esSector} onChange={(event) => setEsSector(event.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-zinc-900">Cuenta de sector</span>
              <span className="block text-[0.8125rem] text-zinc-500">
                {esSector
                  ? "Una sesión compartida por puesto de trabajo (mostrador, laboratorio), no una persona. No tiene PIN ni cambia su contraseña: en las acciones que piden PIN, cada empleado se identifica con el suyo. No admite los roles Administrador ni Director Técnico y no se puede cambiar después."
                  : "Apagado: cuenta personal de una persona, con su propia contraseña y su PIN. Encendelo para una sesión compartida por puesto de trabajo (mostrador, laboratorio). No se puede cambiar después."}
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="nombre" className="field-label">
                {esSector ? "Nombre del sector" : "Nombre"}
              </label>
              <input id="nombre" name="nombre" required placeholder={esSector ? "Laboratorio" : undefined} className="input" />
            </div>
            {esSector ? null : (
              <div className="field">
                <label htmlFor="apellido" className="field-label">
                  Apellido
                </label>
                <input id="apellido" name="apellido" required className="input" />
              </div>
            )}
            <div className="field">
              <label htmlFor="email" className="field-label">
                Email
              </label>
              <input id="email" name="email" type="email" required aria-describedby={esSector ? "email-ayuda" : undefined} className="input" />
              {esSector ? (
                <p id="email-ayuda" className="field-help">
                  Es el usuario con el que la cuenta inicia sesión. No hace falta que sea una casilla real: el sistema no le envía correos.
                </p>
              ) : null}
            </div>
            {esSector ? null : (
              <>
                <div className="field">
                  <label htmlFor="dni" className="field-label">
                    DNI
                  </label>
                  <input id="dni" name="dni" required className="input font-mono" />
                </div>
                <div className="field">
                  <label htmlFor="numeroMatricula" className="field-label">
                    Matrícula <span className="font-normal text-zinc-500">(opcional)</span>
                  </label>
                  <input id="numeroMatricula" name="numeroMatricula" className="input font-mono" />
                </div>
              </>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="field-label mb-2">
              Roles <span className="font-normal text-zinc-500">(al menos uno)</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((rol) => (
                <label key={rol.codigo} className="choice-row">
                  <input type="checkbox" name="roles" value={rol.codigo} className="size-4" />
                  <span className="font-medium text-zinc-900">{rol.nombre}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-4">
            <NewPasswordFields
              name="passwordTemporal"
              repeatName="passwordTemporalRepeat"
              label={esSector ? "Contraseña" : "Contraseña temporal"}
              repeatLabel={esSector ? "Repetir contraseña" : "Repetir contraseña temporal"}
              requirements={esSector ? PASSWORD_REQUIREMENTS : TEMPORARY_PASSWORD_REQUIREMENTS}
              onValidityChange={setPasswordValid}
            />
          </div>

          {state.status === "error" ? (
            <div ref={alertRef} role="alert" tabIndex={-1} className="alert alert-danger outline-none">
              <CircleAlert aria-hidden />
              <span>{state.message}</span>
            </div>
          ) : null}

          <div>
            <SubmitButton pending={isPending} disabled={!passwordValid} />
          </div>
        </div>
      </form>

      {reauth.abierto ? <ReauthPrompt onReauthenticated={resubmit} onCancel={reauth.cancelar} /> : null}
    </div>
  );
}
