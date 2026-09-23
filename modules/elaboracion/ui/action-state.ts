/** Shared Server Action result shape for `/recetas/[id]/items/[itemId]/ficha-tecnica` (FASE 7). Own copy per module -- see modules/recetas/ui/action-state.ts. */
export type FichaActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message?: string; id?: string; version?: number };

export const IDLE_STATE: FichaActionState = { status: "idle" };
