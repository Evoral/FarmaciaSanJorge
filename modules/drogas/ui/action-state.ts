/** Shared Server Action result shape for `/catalogos/drogas` (FASE 4 point 4.2). Own copy per module -- see modules/parametros/ui/action-state.ts. */
export type DrogaActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string };

export const IDLE_STATE: DrogaActionState = { status: "idle" };
