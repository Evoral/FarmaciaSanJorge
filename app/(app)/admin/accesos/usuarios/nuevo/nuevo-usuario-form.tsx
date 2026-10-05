"use client";

/**
 * Client form of `/admin/accesos/usuarios/nuevo` (M03, FASE 3 point 3.2); the
 * server page (`./page.tsx`) loads the tenant's assignable roles (DP-03:
 * per-tenant data) and passes them in as `roles`. After a successful
 * submit, the one-time activation credential is shown INLINE (never
 * redirected to a URL, never put in a query string -- see
 * `modules/usuarios/application/crear-usuario.ts`'s doc comment on why it
 * is shown exactly once) with a prominent, explicit "won't be shown again"
 * notice.
 *
 * M2 (security review): `status === "reauth-required"` (see `./actions.ts`)
 * shows `modules/auth/ui/reauth-prompt.tsx` and, once re-authentication
 * succeeds, resubmits the SAME data via `useReauthFormSubmit`'s
 * `resubmit()` (the FormData captured on the original submit) -- same
 * pattern as `modules/auth/ui/reauth-aware-form.tsx`, just inlined
 * here because this page owns a richer success state (the one-time
 * credential) that the generic wrapper doesn't model. It must NOT re-read
 * the DOM (`requestSubmit()`): React 19 auto-resets a `<form action>` on
 * every submit, so the retry would send empty fields and no roles. See
 * `modules/auth/ui/use-reauth-form-submit.ts`. Because the hook's
 * `onSubmit` prevents that auto-reset, a failed submit also keeps what the
 * user typed; the form is cleared explicitly on success below. The error's
 * `fields` are marked invalid (`shared/ui/field-errors.ts`).
 */
import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { crearUsuarioAction, type CrearUsuarioFormState } from "./actions";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import { useReauthFormSubmit } from "@/modules/auth/ui/use-reauth-form-submit";
import { CredencialActivacion } from "@/modules/usuarios/ui/credencial-activacion";
import { errorFieldsOf } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { PageHeader } from "@/shared/ui/page-header";

const initialCrearUsuarioState: CrearUsuarioFormState = { status: "idle", message: null };

const BREADCRUMBS = [{ label: "Inicio", href: "/" }, { label: "Usuarios y accesos" }, { label: "Usuarios", href: "/admin/accesos/usuarios" }];

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? <span className="spinner" aria-hidden /> : null}
      {pending ? "Creando…" : "Crear usuario"}
    </button>
  );
}

export function NuevoUsuarioForm({ roles }: { roles: readonly { codigo: string; nombre: string }[] }) {
  const [state, formAction, isPending] = useActionState(crearUsuarioAction, initialCrearUsuarioState);
  const { onSubmit, resubmit } = useReauthFormSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === "error" || state.status === "success") {
      alertRef.current?.focus();
    }
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  // After the effect above: when the error names fields, focus lands on the first of them (the alert is still announced).
  useFieldErrors(formRef, errorFieldsOf(state));

  if (state.status === "success" && state.credencial) {
    return (
      <div className="max-w-2xl">
        <PageHeader breadcrumbs={[...BREADCRUMBS, { label: "Usuario creado" }]} title="Usuario creado" description="Queda pendiente de activación hasta que la persona use esta credencial." />
        <CredencialActivacion ref={alertRef} titulo="Credencial de activación: se muestra una sola vez" credencial={state.credencial} venceEn={state.credencialVenceEn!}>
          Entregásela a la persona en mano. No queda guardada en ningún lado ni se puede volver a mostrar: si se pierde, usá «Restablecer credencial» desde el detalle del
          usuario.
        </CredencialActivacion>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/admin/accesos/usuarios/${state.usuarioId}`} className="btn btn-primary">
            Ver detalle del usuario
          </Link>
          <Link href="/admin/accesos/usuarios" className="btn btn-secondary">
            Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumbs={[...BREADCRUMBS, { label: "Nuevo usuario" }]}
        title="Nuevo usuario"
        description="Queda pendiente de activación. Vas a ver la credencial de un solo uso apenas se cree; no hay autorregistro ni envío automático (contactalo/a vos mismo/a)."
      />

      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="panel">
        <div className="panel-header">
          <h2>Datos de la persona</h2>
        </div>
        <div className="panel-body flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="nombre" className="field-label">
                Nombre
              </label>
              <input id="nombre" name="nombre" required className="input" />
            </div>
            <div className="field">
              <label htmlFor="apellido" className="field-label">
                Apellido
              </label>
              <input id="apellido" name="apellido" required className="input" />
            </div>
            <div className="field">
              <label htmlFor="email" className="field-label">
                Email
              </label>
              <input id="email" name="email" type="email" required className="input" />
            </div>
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

          {state.status === "error" ? (
            <div ref={alertRef} role="alert" tabIndex={-1} className="alert alert-danger outline-none">
              <CircleAlert aria-hidden />
              <span>{state.message}</span>
            </div>
          ) : null}

          <div>
            <SubmitButton pending={isPending} />
          </div>
        </div>
      </form>

      {state.status === "reauth-required" ? <ReauthPrompt onReauthenticated={resubmit} onCancel={() => undefined} /> : null}
    </div>
  );
}
