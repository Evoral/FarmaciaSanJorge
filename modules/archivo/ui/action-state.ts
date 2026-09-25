/** Shared Server Action result shape for `/archivo/**` (FASE 12). Own copy per module -- see modules/cierres/ui/action-state.ts. */
export type ArchivoActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string };

export const IDLE_STATE: ArchivoActionState = { status: "idle" };
