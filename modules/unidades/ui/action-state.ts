/**
 * Shared Server Action result shape for `/admin/unidades` (FASE 4 point
 * 4.1). Own copy per module -- same convention as
 * modules/parametros/ui/action-state.ts. No `reauth-required` variant here:
 * unlike usuarios' sensitive admin actions, none of this module's commands
 * declare `requireRecentReauth` (catalog CRUD, not identity-affecting).
 */
export type UnidadActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string };

export const IDLE_STATE: UnidadActionState = { status: "idle" };
