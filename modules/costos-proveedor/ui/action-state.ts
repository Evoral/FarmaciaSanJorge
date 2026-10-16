import type { VistaPreviaLista } from "../domain/importacion-lista";

/** Shared Server Action result shape for `/costos-proveedor`. Own copy per module -- see modules/parametros/ui/action-state.ts. */
export type CostoProveedorActionState = { status: "idle" } | { status: "error"; message: string; fields?: string[] } | { status: "success"; message?: string };

/** The vigente costo of a (droga, proveedor) pair as the manual form shows it: what the user is about to change. */
export interface CostoVigenteResumen {
  /** Sent back as `vigenteEsperadoId` (R23). */
  id: string;
  precioInformado: string;
  unidadPrecioId: string;
  unidadPrecioSimbolo: string;
  costoUnitario: string;
  /** `YYYY-MM-DD`. */
  fechaPrecio: string;
  /** `null` = a manual entry. */
  listaNombreArchivo: string | null;
}

export type CostoVigenteDelParState = { status: "ok"; costo: CostoVigenteResumen | null } | { status: "error"; message: string };

/** Result of reading a price list (stage E4): the preview to review, or why it could not be read. Reads write nothing. */
export type LeerListaState = { status: "idle" } | { status: "success"; vista: VistaPreviaLista } | { status: "error"; message: string; fields?: string[] };

export const IDLE_LEER_LISTA_STATE: LeerListaState = { status: "idle" };
