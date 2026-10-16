/**
 * Shared Server Action result shape for `/entregas` (FASE 11). Own copy per module -- see modules/recetas/ui/action-state.ts.
 * `operador-required`: a cuenta de sector must say which empleado is acting (`conOperador`, shared/auth/operador-context.ts).
 */
export type EntregaActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "operador-required" }
  | { status: "success"; message?: string; id?: string };

export const IDLE_STATE: EntregaActionState = { status: "idle" };
