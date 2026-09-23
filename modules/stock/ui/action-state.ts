/** Shared Server Action result shape for `/stock/**` (FASE 5). Own copy per module -- see modules/proveedores/ui/action-state.ts. */
export type StockActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string };

export const IDLE_STATE: StockActionState = { status: "idle" };
