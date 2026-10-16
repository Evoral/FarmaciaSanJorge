"use client";

/**
 * Submit plumbing for EVERY Server Action form (`<form action>` +
 * `useActionState`): what the user typed must survive an error result.
 *
 * WHY THIS EXISTS: React 19 automatically RESETS a `<form action={fn}>`
 * on every submit -- react-dom's `startHostTransition` calls
 * `requestFormReset(formFiber)` right before running the action, whatever
 * the action ends up returning. A `{ status: "error" }` result (a wrong
 * date, a missing vale number...) therefore threw away everything the user
 * had typed, and a re-auth retry that re-read the DOM with
 * `requestSubmit()` sent an already-wiped form.
 *
 * THE FIX: `onSubmit` calls `event.preventDefault()`. When the submit
 * event's default is prevented, React's form-action listener neither runs
 * the `action` prop nor resets the form (if a transition was started
 * during the event it only calls `startHostTransition` with a `null`
 * action, i.e. a no-op without `requestFormReset`). We build the
 * `FormData` ourselves (including the clicked submitter's name/value),
 * keep it in a ref and dispatch it to `useActionState`'s `formAction`
 * inside a transition. `resubmit()` re-dispatches that SAME stored
 * `FormData` (what `modules/auth/ui/reauth-prompt.tsx`'s
 * `onReauthenticated` calls, via `modules/auth/ui/use-reauth-form-submit.ts`),
 * so a retry never depends on the DOM's current contents. Clearing the
 * form is now the caller's explicit decision, typically `form.reset()` on
 * a success result only (`./simple-form.tsx`).
 *
 * `onSubmit` also clears the previous result's invalid-field marks
 * (`./field-errors.ts`) and stops the submit event's propagation: a form
 * rendered inside another form's React tree (the receta form's
 * paciente/médico/droga pickers) must not also trigger the outer form's
 * `onSubmit`.
 *
 * Callers keep `action={formAction}` on the `<form>` as well: before
 * hydration (no `onSubmit` attached yet) React still wires the Server
 * Action through it, and without it a pre-hydration submit would be a
 * native GET that leaks every field into the URL.
 *
 * Pending state: `useFormStatus` does not reliably track a transition
 * dispatched manually (and never tracks `resubmit()`, which isn't a submit
 * event at all), so callers drive their submit button from
 * `useActionState`'s third return value (`isPending`) instead.
 *
 * CUENTAS DE SECTOR (docs/specs/cuentas-de-sector.md): on a shared session,
 * some acciones must say which empleado performs them. With `opciones`,
 * this hook asks for it (`./operador.tsx`'s prompt: who + PIN) and submits
 * the SAME `FormData` with the credential fields added:
 *   - `accion`: when the farmacia asks a PIN for that permiso, the prompt
 *     opens BEFORE the first submit (one round trip);
 *   - `estado` (the `useActionState` state object itself, never a new
 *     literal): a `{ status: "operador-required" }` result, or an error
 *     about the PIN field, opens it and resubmits -- so a form that did not
 *     declare its `accion` still works, with one extra round trip.
 * In an individual session none of this ever triggers.
 */
import { startTransition, useCallback, useEffect, useRef, type FormEvent } from "react";
import { CAMPO_OPERADOR_PIN } from "@/shared/auth/operador-campos";
import { clearInvalidFields } from "./field-errors";
import { useOperador } from "./operador";

export interface FormSubmit {
  /** Attach as the `<form>`'s `onSubmit` (alongside `action={formAction}`). */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Re-dispatches the last submitted `FormData`. No-op if nothing was submitted yet. */
  resubmit: () => void;
}

export interface FormSubmitOptions {
  /** The form's action state, exactly as `useActionState` returned it. */
  estado?: { status: string; message?: string; fields?: readonly string[] };
  /** The permiso of the action this form submits -- several when the action also performs another acción (saving a receta regenerates its fichas técnicas). */
  accion?: string | readonly string[];
}

export function useFormSubmit(formAction: (payload: FormData) => void, opciones?: FormSubmitOptions): FormSubmit {
  const lastFormData = useRef<FormData | null>(null);
  const estadoAtendido = useRef<object | null>(null);
  const operador = useOperador();
  const estado = opciones?.estado;
  const accion = opciones?.accion;

  const despachar = useCallback((formData: FormData) => startTransition(() => formAction(formData)), [formAction]);

  const despacharConOperador = useCallback(
    (formData: FormData, error?: string) => {
      void operador.pedir(error).then((campos) => {
        if (!campos) return;
        for (const [nombre, valor] of Object.entries(campos)) formData.set(nombre, valor);
        despachar(formData);
      });
    },
    [operador, despachar],
  );

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const form = event.currentTarget;
      clearInvalidFields(form);
      const submitter = (event.nativeEvent as SubmitEvent).submitter ?? null;
      const formData = new FormData(form, submitter);
      lastFormData.current = formData;
      const acciones = accion === undefined ? [] : typeof accion === "string" ? [accion] : accion;
      if (acciones.some((codigo) => operador.requierePin(codigo))) despacharConOperador(formData);
      else despachar(formData);
    },
    [operador, accion, despachar, despacharConOperador],
  );

  const resubmit = useCallback(() => {
    const formData = lastFormData.current;
    if (!formData) return;
    despachar(formData);
  }, [despachar]);

  useEffect(() => {
    // Each result is answered once (a new submit returns a new state object).
    if (!estado || estadoAtendido.current === estado) return;
    estadoAtendido.current = estado;
    const formData = lastFormData.current;
    if (!formData) return;
    if (estado.status === "operador-required") {
      despacharConOperador(formData);
    } else if (estado.status === "error" && estado.fields?.includes(CAMPO_OPERADOR_PIN)) {
      despacharConOperador(formData, estado.message);
    } else if (estado.status === "success") {
      // The act is done: the PIN must not linger in memory.
      formData.delete(CAMPO_OPERADOR_PIN);
    }
  }, [estado, despacharConOperador]);

  return { onSubmit, resubmit };
}
