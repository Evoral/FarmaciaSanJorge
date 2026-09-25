"use client";

/**
 * Designation form for `/admin/directores-tecnicos/nuevo` (M04, FASE 3
 * point 3.9). Same "inline useActionState + ReauthPrompt" pattern as
 * `app/(app)/admin/usuarios/nuevo/page.tsx` -- see that file's doc comment
 * for the full rationale: `./actions.ts`'s `DesignarDirectorTecnicoFormState`
 * carries a `message: string | null` field on every variant (not a
 * discriminated union with per-variant shapes), so it is not the
 * `DtActionState` that `modules/directores-tecnicos/ui/reauth-aware-form.tsx`
 * expects -- this component predates/bypasses that shared wrapper the same
 * way usuarios/nuevo does, instead of forcing an incompatible type through
 * it.
 */
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { designarDirectorTecnicoAction, initialDesignarDirectorTecnicoState } from "./actions";
import { CARACTERES_DESIGNACION, CARACTER_LABELS } from "@/modules/directores-tecnicos/domain/designacion";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import type { listUsuariosElegiblesDt } from "@/modules/directores-tecnicos/application/list-usuarios-elegibles";

type UsuarioElegible = Awaited<ReturnType<typeof listUsuariosElegiblesDt>>[number];

export interface NuevaDesignacionFormProps {
  usuarios: UsuarioElegible[];
}

function SubmitButton() {
  const { pending } = useFormStatus();
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
  const [state, formAction] = useActionState(designarDirectorTecnicoAction, initialDesignarDirectorTecnicoState);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "error" || state.status === "success") {
      alertRef.current?.focus();
    }
    if (state.status === "success") {
      router.refresh();
    }
  }, [state, router]);

  if (state.status === "success") {
    return (
      <div
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className="rounded border-2 border-emerald-500 bg-emerald-50 p-4 outline-none dark:bg-emerald-950"
      >
        <p className="mb-2 font-semibold text-emerald-900 dark:text-emerald-200">Designación registrada.</p>
        <a href="/admin/directores-tecnicos" className="text-sm underline">
          Volver al listado
        </a>
      </div>
    );
  }

  return (
    <>
      <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
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
            Nota: la superposición de designaciones SUPLENTE no está restringida (DP-11 pendiente de definición).
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
          <input
            id="vigenteDesde"
            name="vigenteDesde"
            type="date"
            required
            className="input"
          />
        </div>

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
    </>
  );
}
