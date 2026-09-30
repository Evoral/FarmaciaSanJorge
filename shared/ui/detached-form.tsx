"use client";

/**
 * A `<form>` rendered OUTSIDE the surrounding markup (portal to
 * `document.body`), for a sub-form that visually lives inside another form
 * -- e.g. the receta form's paciente/médico/droga pickers. HTML forbids
 * nesting `<form>` elements (invalid markup and a React hydration error),
 * so the sub-form's controls stay where they are and join this form through
 * the standard `form="<id>"` attribute: Enter, submit buttons, `FormData`,
 * `reset()` and `form.elements` (used by `./field-errors.ts`) all behave as
 * in a regular form, and those controls are NOT part of the outer form.
 *
 * Rendered only on the client, after hydration (there is no `document` on
 * the server). Until then, controls pointing at the missing id have no form
 * owner at all -- never the outer form.
 *
 * React events from a portal still bubble through the React tree: submit
 * handlers must stop propagation so the outer form never sees this submit
 * (`./use-form-submit.ts#useFormSubmit` already does).
 */
import { useSyncExternalStore, type FormEvent, type Ref } from "react";
import { createPortal } from "react-dom";

export interface DetachedFormProps {
  /** The id every control of this sub-form references with `form={id}`. */
  id: string;
  action: (payload: FormData) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  ref?: Ref<HTMLFormElement>;
  "aria-label"?: string;
}

const subscribeNoop = () => () => {};

export function DetachedForm({ id, action, onSubmit, ref, "aria-label": ariaLabel }: DetachedFormProps) {
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);
  if (!hydrated) return null;
  return createPortal(<form id={id} ref={ref} action={action} onSubmit={onSubmit} noValidate aria-label={ariaLabel} hidden />, document.body);
}
