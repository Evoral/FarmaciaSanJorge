/** Shared Server Action result shape for `/admin/precios` and `/recetas/[id]/items/[itemId]/cotizacion` (FASE 4 point 4.6 / FASE 7 point 7.4). Own copy per module -- see modules/stock/ui/action-state.ts for the shared shape. */
export type PreciosActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string };

export const IDLE_STATE: PreciosActionState = { status: "idle" };
