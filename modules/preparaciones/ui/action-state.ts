/**
 * Shared Server Action result shape for `/preparaciones/**` (FASE 8).
 * `"reauth-required"` is how `confirmarPreparacionAction` surfaces
 * `StepUpRequiredError` back to the client (INV-X02) -- own small copy of
 * `modules/directores-tecnicos/ui/action-state.ts`'s shape (module
 * boundary: this module must not import a sibling module's `ui/`).
 */
export type PreparacionActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "reauth-required" }
  | { status: "success"; message?: string; id?: string };

export const IDLE_STATE: PreparacionActionState = { status: "idle" };
