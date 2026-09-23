/**
 * Shared Server Action result shape for every sensitive admin action in
 * this module (suspender/reactivar/baja/restablecerCredencial/cambiarRoles).
 * `"reauth-required"` is how a Server Action surfaces `StepUpRequiredError`
 * (thrown by `shared/usecase.ts`'s `requireRecentReauth` step) back to the
 * client -- see `modules/usuarios/ui/reauth-aware-form.tsx`, the one place
 * that interprets this status and shows `modules/auth/ui/reauth-prompt.tsx`.
 */
export type UsuarioActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "reauth-required" }
  | { status: "success"; message?: string };

export const IDLE_STATE: UsuarioActionState = { status: "idle" };
