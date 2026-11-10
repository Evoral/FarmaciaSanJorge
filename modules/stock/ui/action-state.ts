import type { VistaPreviaFactura } from "../domain/importacion-factura-compra";
import type { ImportarPlanillaExcelResultado } from "../application/importar-planilla-excel";

/**
 * Shared Server Action result shape for `/stock/**` (FASE 5). Own copy per module -- see modules/proveedores/ui/action-state.ts.
 * `operador-required`: a cuenta de sector must say which empleado is acting (`conOperador`, shared/auth/operador-context.ts).
 */
export type StockActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "operador-required" }
  | { status: "success"; message?: string; redirigirA?: string; /** "Elaborar lote": the new partida. */ partidaId?: string };

export const IDLE_STATE: StockActionState = { status: "idle" };

/** Result of reading a supplier invoice PDF (/partidas/ingresar, "Importar factura"). */
export type LeerFacturaPdfState = { status: "idle" } | { status: "error"; message: string } | { status: "success"; vistaPrevia: VistaPreviaFactura };

export const IDLE_LEER_FACTURA_STATE: LeerFacturaPdfState = { status: "idle" };

/** Result of importing planilla de existencia inicial from Excel. */
export type ImportarPlanillaExcelState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      message: string;
      resultado: ImportarPlanillaExcelResultado;
    };

export const IDLE_IMPORTAR_PLANILLA_EXCEL_STATE: ImportarPlanillaExcelState = {
  status: "idle",
};
