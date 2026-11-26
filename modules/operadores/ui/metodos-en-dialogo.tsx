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
import { HUELLA_LONGITUD_MAXIMA } from "@/modules/auth/domain/verificacion-identidad";
import { CodigoLectorInput } from "@/shared/ui/codigo-lector-input";
import { PasswordInput } from "@/shared/ui/password-input";

export interface CampoDeMetodoProps {
  id: string;
  ref: Ref<HTMLInputElement>;
  /** What was typed so far, by proof key. */
  valores: Record<string, string>;
  onChange(clave: string, valor: string): void;
  /** The server just rejected this method's proof and the empleado has not touched the field since: mark it (`aria-invalid`). */
  invalido: boolean;
  /** The proof was just sent: the field no longer accepts input while the dialog finishes closing (a reader's second Enter lands here). */
  enviado: boolean;
}

export interface MetodoEnDialogo {
  /** The dialog opens on the enabled method with the highest priority. */
  prioridad: number;
  /** The line under the dialog title while this method is selected. */
  ayuda: string;
  /** Shown under the method's switch in the farmacia configuration (`./metodos-verificacion-form.tsx`): how it works and what to set up. */
  notaDeConfiguracion?: string;
  Campo(props: CampoDeMetodoProps): ReactNode;
}

export const METODOS_EN_DIALOGO: { [M in MetodoVerificacion]: MetodoEnDialogo } = {
  PIN: {
    prioridad: 0,
    ayuda: "Ingresá tu PIN. La acción queda registrada a tu nombre.",
    Campo: ({ id, ref, valores, onChange, invalido, enviado }) => (
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
          aria-invalid={invalido || undefined}
          readOnly={enviado}
          className="input"
        />
      </div>
    ),
  },
  // The wedge reader types the code into the focused field and presses Enter, which submits the form. The field is masked
  // and opts out of autofill and password managers (`CodigoLectorInput`). A rejected code is cleared with the rest of the
  // dialog's state (a mis-scan: there is nothing to fix by editing it) and the field is marked.
  HUELLA: {
    prioridad: 10,
    ayuda: "Pasá tu huella por el lector. La acción queda registrada a tu nombre.",
    notaDeConfiguracion:
      "El lector funciona como un teclado: escribe un código y termina con Enter (igual que el lector de QR). Configuralo para que agregue Enter al final y no agregue prefijo. Cada empleado enrola su huella desde Mi cuenta. El código es un secreto fijo: quien lo conozca puede identificarse como esa persona, por eso se guarda solo como hash, igual que el PIN.",
    Campo: ({ id, ref, valores, onChange, invalido, enviado }) => (
      <div className="field">
        <label htmlFor={id} className="field-label">
          Huella
        </label>
        <CodigoLectorInput
          ref={ref}
          id={id}
          value={valores.huella ?? ""}
          onChange={(event) => onChange("huella", event.target.value)}
          maxLength={HUELLA_LONGITUD_MAXIMA}
          required
          aria-invalid={invalido || undefined}
          readOnly={enviado}
        />
      </div>
    ),
  },
};
