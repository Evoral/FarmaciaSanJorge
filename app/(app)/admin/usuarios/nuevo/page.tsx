"use client";

/**
 * `/admin/usuarios/nuevo` (M03, FASE 3 point 3.2). After a successful
 * submit, the one-time activation credential is shown INLINE (never
 * redirected to a URL, never put in a query string -- see
 * `modules/usuarios/application/crear-usuario.ts`'s doc comment on why it
 * is shown exactly once) with a prominent, explicit "won't be shown again"
 * notice.
 *
 * M2 (security review): `status === "reauth-required"` (see `./actions.ts`)
 * shows `modules/auth/ui/reauth-prompt.tsx` and, once re-authentication
 * succeeds, resubmits the SAME form via `formRef.current.requestSubmit()`
 * -- same pattern as `modules/usuarios/ui/reauth-aware-form.tsx`, just
 * inlined here because this page owns a richer success state (the
 * one-time credential) that the generic wrapper doesn't model.
 */
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { crearUsuarioAction, initialCrearUsuarioState } from "./actions";
import { ROLES_ASIGNABLES, ROL_LABELS } from "@/modules/usuarios/domain/roles";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
    >
      {pending ? "Creando…" : "Crear usuario"}
    </button>
  );
}

export default function NuevoUsuarioPage() {
  const [state, formAction] = useActionState(crearUsuarioAction, initialCrearUsuarioState);
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

  if (state.status === "success" && state.credencial) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="mb-4 text-xl font-semibold">Usuario creado</h1>
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded border-2 border-amber-500 bg-amber-50 p-4 outline-none dark:bg-amber-950"
        >
          <p className="mb-2 font-semibold text-amber-900 dark:text-amber-200">
            Credencial de activación — se muestra una sola vez
          </p>
          <p className="mb-3 text-sm text-amber-900 dark:text-amber-200">
            Entregásela a la persona en mano. Vence el {new Date(state.credencialVenceEn!).toLocaleString("es-AR")} (72 horas). No
            queda guardada en ningún lado ni se puede volver a mostrar: si se pierde, usá &quot;Restablecer credencial&quot; desde el
            detalle del usuario.
          </p>
          <code className="block break-all rounded bg-white px-3 py-2 text-sm dark:bg-zinc-900">{state.credencial}</code>
        </div>
        <div className="mt-4 flex gap-4">
          <Link href={`/admin/usuarios/${state.usuarioId}`} className="text-sm underline">
            Ver detalle del usuario
          </Link>
          <Link href="/admin/usuarios" className="text-sm underline">
            Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-xl font-semibold">Nuevo usuario</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        El usuario queda pendiente de activación. Vas a ver la credencial de un solo uso apenas se cree; no hay autorregistro ni
        envío automático (contactalo/a vos mismo/a).
      </p>

      <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre
          </label>
          <input id="nombre" name="nombre" required className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="apellido" className="text-sm font-medium">
            Apellido
          </label>
          <input id="apellido" name="apellido" required className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input id="email" name="email" type="email" required className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="dni" className="text-sm font-medium">
            DNI
          </label>
          <input id="dni" name="dni" required className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="numeroMatricula" className="text-sm font-medium">
            Matrícula (opcional)
          </label>
          <input id="numeroMatricula" name="numeroMatricula" className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Roles (al menos uno)</legend>
          {ROLES_ASIGNABLES.map((codigo) => (
            <label key={codigo} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="roles" value={codigo} className="h-4 w-4" />
              {ROL_LABELS[codigo]}
            </label>
          ))}
        </fieldset>

        {state.status === "error" ? (
          <div ref={alertRef} role="alert" tabIndex={-1} className="text-sm text-red-600 outline-none">
            {state.message}
          </div>
        ) : null}

        <SubmitButton />
      </form>

      {state.status === "reauth-required" ? (
        <ReauthPrompt onReauthenticated={() => formRef.current?.requestSubmit()} onCancel={() => undefined} />
      ) : null}
    </div>
  );
}
