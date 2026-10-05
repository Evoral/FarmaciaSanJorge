/** Shared Server Action result shapes for `/recetas` (FASE 6). Own copy per module -- see modules/pacientes/ui/action-state.ts. */
import type { VistaPreviaImportacion } from "../domain/importacion-receta";
import type { Presupuesto } from "../domain/presupuesto";

export type RecetaActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  /** `redirigirA`: where the form navigates on success, with the automatic ficha/cotización notices (codes only) -- domain/avisos-generacion.ts. */
  | { status: "success"; message?: string; id?: string; numeroInterno?: string; redirigirA?: string };

export const IDLE_STATE: RecetaActionState = { status: "idle" };

export interface PersonaOpcion {
  id: string;
  nombre: string;
  apellido: string;
}

export type BuscarPersonaState =
  | { status: "idle"; items: PersonaOpcion[] }
  | { status: "error"; message: string; items: PersonaOpcion[] }
  | { status: "success"; items: PersonaOpcion[] };

export const IDLE_BUSCAR_PERSONA_STATE: BuscarPersonaState = { status: "idle", items: [] };

export type CrearPersonaRapidaState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "success"; persona: PersonaOpcion };

export const IDLE_CREAR_PERSONA_STATE: CrearPersonaRapidaState = { status: "idle" };

/** Result of reading a receta (PDF or QR): the preview travels back only in this POST response (DP-24), never in a URL. */
export type LeerRecetaState =
  | { status: "idle" }
  /** `campo: "codigo"`: the error is about the typed QR/link itself (not an outage or a permission error), so the QR input is marked invalid. */
  | { status: "error"; message: string; campo?: "codigo" }
  | { status: "success"; vistaPrevia: VistaPreviaImportacion };

export const IDLE_LEER_RECETA_STATE: LeerRecetaState = { status: "idle" };

/** The PDF import's original names. */
export type LeerRecetaPdfState = LeerRecetaState;
export const IDLE_LEER_PDF_STATE = IDLE_LEER_RECETA_STATE;

/** Result of the live presupuesto (docs/specs/presupuesto-receta.md). */
export type PresupuestoState = { status: "success"; presupuesto: Presupuesto } | { status: "error"; message: string };
