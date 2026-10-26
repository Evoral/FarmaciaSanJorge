"use client";

/**
 * `/admin/accesos/usuarios/[id]` "Asignar contraseña temporal" action (M03,
 * FASE 3 point 3.6, INV-U08; openspec/specs/contrasena-temporal/spec.md). The
 * Administrador types a new temporary password twice; the usuario's open
 * sessions are closed and they must change it at the next login. Nothing
 * secret comes back, so there is no one-time display.
 *
 * Submits through `useFormSubmit` so a rejected password keeps what was typed
 * (the error's `fields` are marked on the controls). Because the form is not
 * auto-reset, a success remounts the password fields (`key`) to clear them,
 * and `router.refresh()` updates the estado badge (a pending usuario is now
 * active).
 */
import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { restablecerCredencialAction } from "./actions";
import type { RestablecerCredencialState } from "./actions";
import { NewPasswordFields } from "@/modules/auth/ui/new-password-fields";
import { PASSWORD_REQUIREMENTS, TEMPORARY_PASSWORD_REQUIREMENTS } from "@/shared/auth/policy";
import { FormActions, FormFeedback, SubmitButton, errorFieldsOf } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

const initialState: RestablecerCredencialState = { status: "idle" };

/** `esSector`: a cuenta de sector's password is definitive (full policy, no change at login -- openspec/specs/cuentas-de-sector/spec.md). */
export function RestablecerCredencial({ usuarioId, esSector = false }: { usuarioId: string; esSector?: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [fieldsKey, setFieldsKey] = useState(0);
  const [passwordValid, setPasswordValid] = useState(false);
  const [state, formAction, isPending] = useActionState(async (prevState: RestablecerCredencialState, formData: FormData) => {
    const result = await restablecerCredencialAction(prevState, formData);
    if (result.status === "success") {
      setFieldsKey((key) => key + 1);
      router.refresh();
    }
    return result;
  }, initialState);
  const { onSubmit } = useFormSubmit(formAction);

  useFieldErrors(formRef, errorFieldsOf(state));

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <NewPasswordFields
        key={fieldsKey}
        name="passwordTemporal"
        repeatName="passwordTemporalRepeat"
        label={esSector ? "Nueva contraseña" : "Contraseña temporal"}
        repeatLabel={esSector ? "Repetir nueva contraseña" : "Repetir contraseña temporal"}
        requirements={esSector ? PASSWORD_REQUIREMENTS : TEMPORARY_PASSWORD_REQUIREMENTS}
        onValidityChange={setPasswordValid}
      />
      <FormFeedback state={state} layout="stack" />
      <FormActions layout="stack">
        <SubmitButton label={esSector ? "Cambiar contraseña" : "Asignar contraseña temporal"} pendingLabel="Asignando…" pending={isPending} disabled={!passwordValid} variant="secondary" />
      </FormActions>
    </form>
  );
}
