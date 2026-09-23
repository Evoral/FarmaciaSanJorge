/**
 * Shared Server Action result shape for `/admin/farmacia` (FASE 3 point
 * 3.10a). Own copy of modules/usuarios/ui/action-state.ts's shape --
 * task instruction: build a small copy per module instead of importing the
 * usuarios-typed one. See that file's doc comment for what
 * `"reauth-required"` means.
 */
export type FarmaciaActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "reauth-required" }
  | { status: "success"; message?: string };

export const IDLE_STATE: FarmaciaActionState = { status: "idle" };
