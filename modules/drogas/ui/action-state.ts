/**
 * Shared Server Action result shape for `/catalogos/drogas` (FASE 4 point 4.2). Own copy per module -- see modules/parametros/ui/action-state.ts.
 * `operador-required`: a cuenta de sector must say which empleado is acting (`conOperador`, shared/auth/operador-context.ts).
 */
export type DrogaActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "operador-required" }
  /** `droga`: only from `crearDrogaAction`, so an alta opened from another screen can pick what it just created. */
  | { status: "success"; message?: string; droga?: DrogaCreada };

/** The droga an alta just created. */
export interface DrogaCreada {
  id: string;
  nombre: string;
  unidadBaseId: string;
}

export const IDLE_STATE: DrogaActionState = { status: "idle" };
