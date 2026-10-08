/**
 * Shared Server Action result shape for `/preparaciones/**` (FASE 8).
 * `"reauth-required"` is how the confirmation actions surface
 * `StepUpRequiredError` back to the client (INV-X02) -- own small copy of
 * `modules/directores-tecnicos/ui/action-state.ts`'s shape (module
 * boundary: this module must not import a sibling module's `ui/`).
 */
import type { FichaPrevista } from "../application/previsualizar-fichas";
import type { DatosConfirmacion } from "../application/datos-confirmacion";

export type PreparacionActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "reauth-required" }
  | { status: "success"; message?: string; id?: string };

export const IDLE_STATE: PreparacionActionState = { status: "idle" };

/** Result of the toma workspace's live ficha preview (`preparaciones.toma.previsualizarFichas`): one entry per ítem sent, in order. */
export type VistaPreviaFichasState = { status: "success"; fichas: FichaPrevista[] } | { status: "error"; message: string };

/** What the toma workspace's "Continuar" / "Modificar reserva" dialog reads when it opens (`preparaciones.confirmacionDeFicha` / `preparaciones.modificacionDeReserva`). */
export type ConfirmacionDeFichaState = { status: "success"; datos: DatosConfirmacion } | { status: "error"; message: string };
