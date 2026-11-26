"use client";

/**
 * The client registry of verification methods: how each method's proof is typed or scanned in the operador dialog
 * (`./operador-provider.tsx`, the only consumer). One entry per `MetodoVerificacion` (a mapped type: a method missing
 * here fails `npm run typecheck`). The pure facts (label, proof keys) come from the domain catalog
 * (modules/auth/domain/verificacion-identidad.ts); the server side is modules/auth/application/metodos-verificacion.ts.
 * Lives in this module, not in `shared/ui`, because `shared/ui` never imports a module.
 */
import type { ReactNode, Ref } from "react";
import { AUTH_POLICY } from "@/shared/auth/policy";
import type { MetodoVerificacion } from "@/modules/auth/domain/verificacion-identidad";
import { PasswordInput } from "@/shared/ui/password-input";

export interface CampoDeMetodoProps {
  id: string;
  ref: Ref<HTMLInputElement>;
  /** What was typed so far, by proof key. */
  valores: Record<string, string>;
  onChange(clave: string, valor: string): void;
}

export interface MetodoEnDialogo {
  /** The dialog opens on the enabled method with the highest priority. */
  prioridad: number;
  /** The line under the dialog title while this method is selected. */
  ayuda: string;
  Campo(props: CampoDeMetodoProps): ReactNode;
}

export const METODOS_EN_DIALOGO: { [M in MetodoVerificacion]: MetodoEnDialogo } = {
  PIN: {
    prioridad: 0,
    ayuda: "Ingresá tu PIN. La acción queda registrada a tu nombre.",
    Campo: ({ id, ref, valores, onChange }) => (
      <div className="field">
        <label htmlFor={id} className="field-label">
          PIN
        </label>
        <PasswordInput
          ref={ref}
          id={id}
          value={valores.pin ?? ""}
          onChange={(event) => onChange("pin", event.target.value)}
          inputMode="numeric"
          pattern={`\\d{${AUTH_POLICY.pinLength}}`}
          maxLength={AUTH_POLICY.pinLength}
          required
          autoComplete="off"
          className="input"
        />
      </div>
    ),
  },
};
