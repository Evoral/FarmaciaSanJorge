/** Shared Server Action result shape for `/catalogos/medicos` (FASE 4 point 4.4). Own copy per module -- see modules/proveedores/ui/action-state.ts. */
export type MedicoActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string };

export const IDLE_STATE: MedicoActionState = { status: "idle" };
