/**
 * Shared Server Action result shape for `/admin/configuracion/etiquetas`.
 * Own copy per module (same convention as modules/parametros/ui/action-state.ts).
 * Every command of this module requires recent re-authentication, so the
 * `reauth-required` variant is how a Server Action surfaces
 * `StepUpRequiredError` -- see modules/auth/ui/reauth-aware-form.tsx.
 */
export type EtiquetaTamanoActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "reauth-required" }
  | { status: "success"; message?: string };

export const IDLE_STATE: EtiquetaTamanoActionState = { status: "idle" };
