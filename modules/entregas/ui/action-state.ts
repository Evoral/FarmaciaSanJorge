/** Shared Server Action result shape for `/entregas` and `/regularizacion` (FASE 11). Own copy per module -- see modules/recetas/ui/action-state.ts. */
export type EntregaActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string; id?: string };

export const IDLE_STATE: EntregaActionState = { status: "idle" };
