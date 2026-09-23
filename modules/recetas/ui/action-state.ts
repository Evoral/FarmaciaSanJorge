/** Shared Server Action result shapes for `/recetas` (FASE 6). Own copy per module -- see modules/pacientes/ui/action-state.ts. */
export type RecetaActionState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; message?: string; id?: string; numeroInterno?: string };

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
  | { status: "error"; message: string }
  | { status: "success"; persona: PersonaOpcion };

export const IDLE_CREAR_PERSONA_STATE: CrearPersonaRapidaState = { status: "idle" };
