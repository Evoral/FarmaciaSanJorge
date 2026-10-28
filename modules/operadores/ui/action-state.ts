/**
 * Server Action result shapes of `modules/operadores` (own small copy of the
 * per-module `action-state.ts` shape, like modules/parametros/ui/action-state.ts).
 */
export type AccionesConPinActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "reauth-required" }
  | { status: "success"; message?: string };
