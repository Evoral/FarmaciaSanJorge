/** Shared Server Action result shape for `/cierres/**` (FASE 10). Own copy per module -- see modules/libro/ui/action-state.ts. No `reauth-required` variant: `firmarCierre` never calls `requireRecentReauth` (the DT's own password IS the step-up -- see `modules/cierres/application/verificar-password-firma.ts`). */
export type CierresActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string };

export const IDLE_STATE: CierresActionState = { status: "idle" };
