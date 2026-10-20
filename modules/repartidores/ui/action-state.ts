/** Shared Server Action result shape for `/catalogos/repartidores`. Own copy per module -- see modules/proveedores/ui/action-state.ts. */
export type RepartidorActionState = { status: "idle" } | { status: "error"; message: string; fields?: string[] } | { status: "success"; message?: string };

export const IDLE_STATE: RepartidorActionState = { status: "idle" };
