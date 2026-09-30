"use client";

/**
 * Designation form for `/admin/accesos/directores-tecnicos/nuevo` (M04, FASE 3
 * point 3.9). Same "inline useActionState + ReauthPrompt" pattern as
 * `app/(app)/admin/accesos/usuarios/nuevo/page.tsx` -- see that file's doc comment
 * for the full rationale: `./actions.ts`'s `DesignarDirectorTecnicoFormState`
 * carries a `message: string | null` field on every variant (not a
 * discriminated union with per-variant shapes), so it is not the
 * `FormActionState` shape that `modules/auth/ui/reauth-aware-form.tsx`
 * expects -- this component predates/bypasses that shared wrapper the same
 * way usuarios/nuevo does, instead of forcing an incompatible type through
 * it. The re-authentication retry uses `useReauthFormSubmit`'s
 * `resubmit()` (re-dispatches the FormData captured on the original
 * submit): re-reading the DOM would send an empty usuario/matrícula/fecha,
 * since React 19 auto-resets a `<form action>` on every submit -- see
 * `modules/auth/ui/use-reauth-form-submit.ts`. That hook also keeps what the
 * user typed on an error result; the error's `fields` are marked invalid
 * (`shared/ui/field-errors.ts`).
 */
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { designarDirectorTecnicoAction, type DesignarDirectorTecnicoFormState } from "./actions";
import { CARACTERES_DESIGNACION, CARACTER_LABELS } from "@/modules/directores-tecnicos/domain/designacion";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import { useReauthFormSubmit } from "@/modules/auth/ui/use-reauth-form-submit";
import type { listUsuariosElegiblesDt } from "@/modules/directores-tecnicos/application/list-usuarios-elegibles";
import { DateInput } from "@/shared/ui/date-input";
import { errorFieldsOf } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";

type UsuarioElegible = Awaited<ReturnType<typeof listUsuariosElegiblesDt>>[number];

const initialDesignarDirectorTecnicoState: DesignarDirectorTecnicoFormState = { status: "idle", message: null };

export interface NuevaDesignacionFormProps {
  usuarios: UsuarioElegible[];
}

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary"
    >
      {pending ? "Registrando…" : "Registrar designación"}
    </button>
  );
}

export function NuevaDesignacionForm({ usuarios }: NuevaDesignacionFormProps) {
  const [state, formAction, isPending] = useActionState(designarDirectorTecnicoAction, initialDesignarDirectorTecnicoState);
  const { onSubmit, resubmit } = useReauthFormSubmit(formAction);
  const alertRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "error" || state.status === "success") {
      alertRef.current?.focus();
    }
    if (state.status === "success") {
      router.refresh();
    }
  }, [state, router]);

  // After the effect above: when the error names fields, focus lands on the first of them (the alert is still announced).
  useFieldErrors(formRef, errorFieldsOf(state));

  if (state.status === "success") {
    return (
      <div
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className="rounded border-2 border-emerald-500 bg-emerald-50 p-4 outline-none dark:bg-emerald-950"
      >
        <p className="mb-2 font-semibold text-emerald-900 dark:text-emerald-200">Designación registrada.</p>
        <a href="/admin/accesos/directores-tecnicos" className="text-sm underline">
          Volver al listado
        </a>
      </div>
    );
  }

  return (
    <>
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="usuarioId" className="text-sm font-medium">
            Usuario
          </label>
          <select
            id="usuarioId"
            name="usuarioId"
            required
            defaultValue=""
            className="input"
          >
            <option value="" disabled>
              Seleccioná un usuario
            </option>
            {usuarios.map((usuario) => (
              <option key={usuario.id} value={usuario.id}>
                {usuario.apellido}, {usuario.nombre} — DNI {usuario.dni}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Solo se listan usuarios ACTIVOS con el rol Director Técnico.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="caracter" className="text-sm font-medium">
            Carácter
          </label>
          <select
            id="caracter"
            name="caracter"
            required
            defaultValue="TITULAR"
            className="input"
          >
            {CARACTERES_DESIGNACION.map((caracter) => (
              <option key={caracter} value={caracter}>
                {CARACTER_LABELS[caracter]}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Nota: la superposición de designaciones SUPLENTE no está restringida.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="matricula" className="text-sm font-medium">
            Matrícula
          </label>
          <input id="matricula" name="matricula" required className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="expedienteDesignacion" className="text-sm font-medium">
            Expediente de designación (opcional)
          </label>
          <input
            id="expedienteDesignacion"
            name="expedienteDesignacion"
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="vigenteDesde" className="text-sm font-medium">
            Vigente desde
          </label>
          <DateInput
            id="vigenteDesde"
            name="vigenteDesde"
            required
          />
        </div>

        {state.status === "error" ? (
          <div ref={alertRef} role="alert" tabIndex={-1} className="text-sm text-red-600 outline-none">
            {state.message}
          </div>
        ) : null}

        <SubmitButton pending={isPending} />
      </form>

      {state.status === "reauth-required" ? (
        <ReauthPrompt onReauthenticated={resubmit} onCancel={() => undefined} />
      ) : null}
    </>
  );
}
