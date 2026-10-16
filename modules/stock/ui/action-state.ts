import type { VistaPreviaFactura } from "../domain/importacion-factura-compra";

/**
 * Shared Server Action result shape for `/stock/**` (FASE 5). Own copy per module -- see modules/proveedores/ui/action-state.ts.
 * `operador-required`: a cuenta de sector must say which empleado is acting (`conOperador`, shared/auth/operador-context.ts).
 */
export type StockActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "operador-required" }
  | { status: "success"; message?: string; redirigirA?: string };

export const IDLE_STATE: StockActionState = { status: "idle" };

/** Result of reading a supplier invoice PDF (/stock/ingresar, "Importar factura"). */
export type LeerFacturaPdfState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; vistaPrevia: VistaPreviaFactura };

export const IDLE_LEER_FACTURA_STATE: LeerFacturaPdfState = { status: "idle" };
