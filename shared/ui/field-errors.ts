"use client";

/**
 * Marks the form controls a Server Action error points at (the error
 * state's `fields`, built by `./action-error.ts` from `AppError.fields`)
 * as invalid, generically and at the DOM level -- keyed by each control's
 * `name`, so no form has to wire per-field error props.
 *
 * - Marking sets `aria-invalid="true"` on every control named in `fields`
 *   (`.input[aria-invalid="true"]` is styled red in `app/globals.css`) and
 *   focuses the first one in document order. None of the plain controls
 *   this targets declares `aria-invalid` as a React prop, so React never
 *   reconciles (and never overwrites) the attribute.
 * - A mark is removed as soon as the user edits that control (`input` /
 *   `change`), and every mark is removed on the next submit
 *   (`clearInvalidFields`, called by `./use-form-submit.ts`).
 * - Composite widgets that submit through a hidden input (`./date-input.tsx`)
 *   own their visual marking instead: the hidden input receives a
 *   cancelable `FIELD_ERROR_EVENT`; a widget that handles it calls
 *   `preventDefault()`, reflects `detail.invalid` in its own state (so its
 *   `aria-invalid` stays React-owned and never fights this module) and may
 *   set `detail.focusTarget` to its visible field. Hidden inputs nobody
 *   handles are skipped: there is nothing visible to mark.
 */
import { useEffect, type RefObject } from "react";

export const FIELD_ERROR_EVENT = "fsj:field-error";

export interface FieldErrorEventDetail {
  /** `true` = mark as invalid, `false` = clear the mark. */
  invalid: boolean;
  /** Set by the handling widget: the element to focus when this is the first invalid field. */
  focusTarget?: HTMLElement | null;
}

/** Present on every control this module marked; `"delegated"` = a widget handled `FIELD_ERROR_EVENT`, `"self"` = we set `aria-invalid` ourselves. */
const MARK_ATTRIBUTE = "data-field-error";

type FieldControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isFieldControl(element: Element): element is FieldControl {
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
}

function fieldControls(form: HTMLFormElement): FieldControl[] {
  return Array.from(form.elements).filter(isFieldControl);
}

function dispatchFieldError(control: FieldControl, invalid: boolean): { handled: boolean; focusTarget: HTMLElement | null } {
  const detail: FieldErrorEventDetail = { invalid };
  const event = new CustomEvent<FieldErrorEventDetail>(FIELD_ERROR_EVENT, { detail, cancelable: true });
  control.dispatchEvent(event);
  return { handled: event.defaultPrevented, focusTarget: detail.focusTarget ?? null };
}

function onEdit(event: Event): void {
  const control = event.currentTarget as FieldControl;
  const form = control.form;
  if (!form) {
    unmark(control);
    return;
  }
  // Same name = same field (e.g. a radio group or a set of checkboxes): editing one clears them all.
  for (const other of fieldControls(form)) {
    if (other.name === control.name) unmark(other);
  }
}

function unmark(control: FieldControl): void {
  const mark = control.getAttribute(MARK_ATTRIBUTE);
  if (mark === null) return;
  control.removeAttribute(MARK_ATTRIBUTE);
  if (mark === "delegated") {
    dispatchFieldError(control, false);
    return;
  }
  control.removeAttribute("aria-invalid");
  control.removeEventListener("input", onEdit);
  control.removeEventListener("change", onEdit);
}

/** Removes every mark this module placed on `form`'s controls. */
export function clearInvalidFields(form: HTMLFormElement): void {
  for (const control of fieldControls(form)) unmark(control);
}

/** Replaces the current marks with `fields` and focuses the first marked control (document order). */
export function markInvalidFields(form: HTMLFormElement, fields: readonly string[]): void {
  clearInvalidFields(form);
  const names = new Set(fields);
  let first: HTMLElement | null = null;

  for (const control of fieldControls(form)) {
    if (!control.name || !names.has(control.name)) continue;

    const { handled, focusTarget } = dispatchFieldError(control, true);
    if (handled) {
      control.setAttribute(MARK_ATTRIBUTE, "delegated");
      first ??= focusTarget;
      continue;
    }
    if (control.type === "hidden") continue;

    control.setAttribute(MARK_ATTRIBUTE, "self");
    control.setAttribute("aria-invalid", "true");
    control.addEventListener("input", onEdit);
    control.addEventListener("change", onEdit);
    first ??= control;
  }

  first?.focus();
}

/**
 * Marks `fields` on the form behind `formRef` whenever a new error result
 * arrives. Pass the latest action state's fields (`errorFieldsOf(state)` from
 * `./form-parts.tsx`): every action result is a fresh array, so the effect
 * re-runs once per result, and never for re-renders of the same result.
 */
export function useFieldErrors(formRef: RefObject<HTMLFormElement | null>, fields: readonly string[] | undefined): void {
  useEffect(() => {
    const form = formRef.current;
    if (form && fields && fields.length > 0) markInvalidFields(form, fields);
  }, [formRef, fields]);
}
