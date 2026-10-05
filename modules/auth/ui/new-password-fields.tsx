"use client";

/**
 * "Nueva contraseña" + "Repetir contraseña" pair with a live requirements
 * checklist. Every form where a usuario chooses a password (/activar,
 * /cuenta) renders this, and the checklist iterates
 * `PASSWORD_REQUIREMENTS` -- the same list the server validates against
 * (shared/auth/policy.ts) -- so the UI can never drift from the real rule.
 *
 * The checklist appears as soon as either field has content. The parent
 * disables its submit button until `onValidityChange(true)`; the server
 * still re-validates (this is a convenience, not the enforcement point).
 * Inputs are controlled so their values survive a failed server action
 * (React resets uncontrolled form fields after every action).
 */
import { useEffect, useId, useState } from "react";
import { Check, X } from "lucide-react";
import { PASSWORD_REQUIREMENTS } from "@/shared/auth/policy";

export interface NewPasswordFieldsProps {
  /** Form field name of the new password (e.g. "password", "nueva"). */
  name: string;
  /** Form field name of the confirmation (e.g. "passwordRepeat", "nuevaRepeat"). */
  repeatName: string;
  label?: string;
  repeatLabel?: string;
  onValidityChange: (valid: boolean) => void;
}

export function NewPasswordFields({
  name,
  repeatName,
  label = "Nueva contraseña",
  repeatLabel = "Repetir contraseña",
  onValidityChange,
}: NewPasswordFieldsProps) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const checklistId = useId();

  const checks = [
    ...PASSWORD_REQUIREMENTS.map((requirement) => ({ ...requirement, ok: requirement.test(password) })),
    { id: "match", label: "Las dos contraseñas coinciden", ok: repeat.length > 0 && password === repeat, internal: false },
  ];
  // Internal requirements still gate the submit button -- they are only left out of the visible list.
  const valid = checks.every((check) => check.ok);
  const visibleChecks = checks.filter((check) => !check.internal);
  const started = password.length > 0 || repeat.length > 0;

  useEffect(() => {
    onValidityChange(valid);
  }, [valid, onValidityChange]);

  return (
    <>
      <div className="field">
        <label htmlFor={name} className="field-label">
          {label}
        </label>
        <input
          id={name}
          name={name}
          type="password"
          required
          autoComplete="new-password"
          aria-describedby={started ? checklistId : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="input"
        />
      </div>

      <div className="field">
        <label htmlFor={repeatName} className="field-label">
          {repeatLabel}
        </label>
        <input
          id={repeatName}
          name={repeatName}
          type="password"
          required
          autoComplete="new-password"
          aria-describedby={started ? checklistId : undefined}
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          className="input"
        />
      </div>

      {started ? (
        <ul id={checklistId} aria-live="polite" className="flex flex-col gap-1 text-xs">
          {visibleChecks.map((check) => (
            <li
              key={check.id}
              className={`flex items-center gap-2 ${check.ok ? "text-emerald-700" : "text-zinc-500"}`}
            >
              {check.ok ? <Check aria-hidden className="size-3.5 shrink-0" /> : <X aria-hidden className="size-3.5 shrink-0" />}
              <span>
                {check.label}
                <span className="sr-only">{check.ok ? " (cumplido)" : " (pendiente)"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
