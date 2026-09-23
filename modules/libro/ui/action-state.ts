/** Shared Server Action result shape for `/libro/**` (FASE 9). Own copy per module -- see modules/preparaciones/ui/action-state.ts. */
export type LibroActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "reauth-required" }
  | { status: "success"; message?: string };

export const IDLE_STATE: LibroActionState = { status: "idle" };
