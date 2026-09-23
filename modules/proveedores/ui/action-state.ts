/** Shared Server Action result shape for `/catalogos/proveedores` (FASE 4 point 4.3). Own copy per module -- see modules/parametros/ui/action-state.ts. */
export type ProveedorActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string };

export const IDLE_STATE: ProveedorActionState = { status: "idle" };
