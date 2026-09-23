/**
 * Shared Server Action result shape for `/admin/parametros` (FASE 3 point
 * 3.10b). Own copy of modules/usuarios/ui/action-state.ts's shape -- task
 * instruction: build a small copy per module instead of importing the
 * usuarios-typed one.
 */
export type ParametrosActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "reauth-required" }
  | { status: "success"; message?: string };

export const IDLE_STATE: ParametrosActionState = { status: "idle" };
