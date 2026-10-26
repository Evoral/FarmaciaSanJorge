"use client";

/**
 * "PIN" + "Repetir PIN" pair, the PIN counterpart of `NewPasswordFields`.
 * Every form where a usuario chooses their PIN (/cuenta, the mandatory
 * `/configurar-pin` step) renders this, so the length/pattern always follow
 * `AUTH_POLICY.pinLength`. Submits `pin` and `pinRepeat`. Renders the two
 * fields only: the parent decides the layout (stacked or a grid).
 */
import { AUTH_POLICY } from "@/shared/auth/policy";
import { PasswordInput } from "@/shared/ui/password-input";

export function NewPinFields({ label = "Nuevo PIN", repeatLabel = "Repetir PIN", autoFocus = false }: { label?: string; repeatLabel?: string; autoFocus?: boolean }) {
  const pinProps = {
    inputMode: "numeric",
    pattern: `\\d{${AUTH_POLICY.pinLength}}`,
    maxLength: AUTH_POLICY.pinLength,
    required: true,
    autoComplete: "off",
    className: "input font-mono tracking-[0.3em]",
  } as const;

  return (
    <>
      <div className="field">
        <label htmlFor="pin" className="field-label">
          {label} <span className="font-normal text-zinc-500">({AUTH_POLICY.pinLength} dígitos)</span>
        </label>
        <PasswordInput id="pin" name="pin" autoFocus={autoFocus} {...pinProps} />
      </div>

      <div className="field">
        <label htmlFor="pinRepeat" className="field-label">
          {repeatLabel}
        </label>
        <PasswordInput id="pinRepeat" name="pinRepeat" {...pinProps} />
      </div>
    </>
  );
}
