"use client";

/**
 * Client-side contract for "which empleado is acting" in a cuenta de sector
 * (openspec/specs/cuentas-de-sector/spec.md). The form plumbing
 * (`./use-form-submit.ts`) only knows this context: it asks `pedir()` for
 * the credential fields and adds them to the `FormData` it submits. The
 * prompt itself (the empleado's PIN, which alone identifies them) lives in
 * `modules/operadores/ui/operador-provider.tsx`, mounted once in the
 * authenticated layout -- so `shared/ui` never imports a module.
 *
 * Outside that provider (login pages, an individual session) the default
 * value applies: nothing asks for a PIN.
 */
import { createContext, useContext } from "react";

/** The form fields to add to the submit, keyed by `shared/auth/operador-campos.ts` names. */
export type CamposDeOperador = Record<string, string>;

export interface OperadorContextValue {
  /** `true` when the session is a cuenta de sector that holds that acción (a permiso code) and the farmacia asks a PIN for it. */
  requierePin: (accion: string) => boolean;
  /** Opens the prompt (showing `error` when retrying a rejected PIN). Resolves with the credential fields, or `null` if the empleado cancelled. */
  pedir: (error?: string) => Promise<CamposDeOperador | null>;
}

const SIN_OPERADOR: OperadorContextValue = {
  requierePin: () => false,
  pedir: async () => null,
};

const OperadorContext = createContext<OperadorContextValue>(SIN_OPERADOR);

export const OperadorContextProvider = OperadorContext.Provider;

export function useOperador(): OperadorContextValue {
  return useContext(OperadorContext);
}
