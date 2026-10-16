/**
 * Server Action result shapes of `modules/operadores` (own small copy of the
 * per-module `action-state.ts` shape, like modules/parametros/ui/action-state.ts).
 */
import type { OperadorOpcion } from "../application/list-operadores";

export type AccionesConPinActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "reauth-required" }
  | { status: "success"; message?: string };

/** What the operador prompt reads when it opens (`operadores.listar`). */
export type OperadoresState = { status: "success"; operadores: OperadorOpcion[] } | { status: "error"; message: string };
