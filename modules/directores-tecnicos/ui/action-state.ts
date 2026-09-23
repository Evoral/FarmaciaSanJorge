/**
 * Shared Server Action result shape for every sensitive admin action in
 * this module (designar/cesar). Own small copy of
 * `modules/usuarios/ui/action-state.ts`'s shape -- that file is typed to
 * `UsuarioActionState` and lives in a sibling module's `ui/`, which this
 * task must not import from (module boundary; see this module's
 * `reauth-aware-form.tsx` for the same reasoning). `"reauth-required"` is
 * how a Server Action surfaces `StepUpRequiredError` back to the client.
 */
export type DtActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "reauth-required" }
  | { status: "success"; message?: string };

export const IDLE_STATE: DtActionState = { status: "idle" };
