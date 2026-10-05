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
 *
 * The usuario is picked in an autocomplete over the eligible usuarios the page
 * loaded; it submits the same `usuarioId` field the old select did.
 */
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { designarDirectorTecnicoAction, type DesignarDirectorTecnicoFormState } from "./actions";
import { CARACTERES_DESIGNACION, CARACTER_LABELS } from "@/modules/directores-tecnicos/domain/designacion";
import { ReauthPrompt } from "@/modules/auth/ui/reauth-prompt";
import { useReauthFormSubmit } from "@/modules/auth/ui/use-reauth-form-submit";
import type { listUsuariosElegiblesDt } from "@/modules/directores-tecnicos/application/list-usuarios-elegibles";
import { Combobox, filtrarOpciones } from "@/shared/ui/combobox";
import type { ComboboxOption } from "@/shared/ui/combobox";
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
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? <span className="spinner" aria-hidden /> : null}
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
  const [usuario, setUsuario] = useState<ComboboxOption | null>(null);

  const opciones = useMemo(() => usuarios.map((u) => ({ value: u.id, label: `${u.apellido}, ${u.nombre}`, description: `DNI ${u.dni}` })), [usuarios]);
  const search = useMemo(() => filtrarOpciones(opciones, 50), [opciones]);

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
      <div ref={alertRef} role="alert" tabIndex={-1} className="flex flex-col gap-3 outline-none">
        <p className="alert alert-success">
          <CircleCheck aria-hidden />
          <span className="font-medium">Designación registrada.</span>
        </p>
        <div>
          <Link href="/admin/accesos/directores-tecnicos" className="btn btn-secondary">
            Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Combobox
          id="usuarioId-buscar"
          label="Usuario"
          placeholder="Buscar por apellido o nombre"
          search={search}
          value={usuario}
          onChange={setUsuario}
          name="usuarioId"
          helperText="Solo se listan usuarios ACTIVOS con el rol Director Técnico."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="caracter" className="field-label">
              Carácter
            </label>
            <select id="caracter" name="caracter" required defaultValue="TITULAR" className="input">
              {CARACTERES_DESIGNACION.map((caracter) => (
                <option key={caracter} value={caracter}>
                  {CARACTER_LABELS[caracter]}
                </option>
              ))}
            </select>
            <p className="field-help">La superposición de designaciones SUPLENTE no está restringida.</p>
          </div>

          <div className="field">
            <label htmlFor="matricula" className="field-label">
              Matrícula
            </label>
            <input id="matricula" name="matricula" required className="input font-mono" />
          </div>

          <div className="field">
            <label htmlFor="expedienteDesignacion" className="field-label">
              Expediente de designación <span className="font-normal text-zinc-500">(opcional)</span>
            </label>
            <input id="expedienteDesignacion" name="expedienteDesignacion" className="input" />
          </div>

          <div className="field">
            <label htmlFor="vigenteDesde" className="field-label">
              Vigente desde
            </label>
            <DateInput id="vigenteDesde" name="vigenteDesde" required />
          </div>
        </div>

        {state.status === "error" ? (
          <div ref={alertRef} role="alert" tabIndex={-1} className="alert alert-danger outline-none">
            <CircleAlert aria-hidden />
            <span>{state.message}</span>
          </div>
        ) : null}

        <div>
          <SubmitButton pending={isPending} />
        </div>
      </form>

      {state.status === "reauth-required" ? <ReauthPrompt onReauthenticated={resubmit} onCancel={() => undefined} /> : null}
    </>
  );
}
