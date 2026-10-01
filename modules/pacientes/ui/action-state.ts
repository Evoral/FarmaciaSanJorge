/** Shared Server Action result shape for `/pacientes` (FASE 4 point 4.5). Own copy per module -- see modules/proveedores/ui/action-state.ts. */
export type PacienteActionState = { status: "idle" } | { status: "error"; message: string; fields?: string[] } | { status: "success"; message?: string };

export const IDLE_STATE: PacienteActionState = { status: "idle" };
