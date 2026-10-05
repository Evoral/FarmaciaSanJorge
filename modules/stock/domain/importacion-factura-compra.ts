/**
 * Supplier invoice import (/stock/ingresar): what the read step hands to
 * the form (one editable row per lote) and the shared messages. Pure.
 */
import type { ViaMatchDroga } from "@/modules/recetas/domain/importacion-receta";
import type { AdvertenciaParserFactura, BorradorFactura } from "./factura-compra-pdf-parser";

export type CodigoAdvertenciaFactura = AdvertenciaParserFactura["codigo"] | "PROVEEDOR_SIN_MATCH" | "PROVEEDOR_DADO_DE_BAJA" | "DROGA_SIN_MATCH" | "UNIDAD_SIN_MATCH";

export interface AdvertenciaFactura {
  codigo: CodigoAdvertenciaFactura;
  mensaje: string;
}

/** One lote of one invoice item -- one partida on confirmation. */
export interface LineaFacturaVistaPrevia {
  codigo: string;
  descripcion: string;
  /** What the catalog was searched with; offered as "recordar equivalencia" when the user picks the droga by hand. */
  drogaTexto: string;
  drogaId: string | null;
  drogaNombre: string | null;
  via: ViaMatchDroga | null;
  unidadTexto: string;
  unidadCompraId: string | null;
  cantidad: string;
  /** Net, per unidad de compra. */
  precioUnitario: string;
  lote: string;
  despacho: string | null;
  paisOrigen: string | null;
  fechaVencimiento: string | null;
}

export interface VistaPreviaFactura {
  /** Header only -- the items are flattened into `lineas`. */
  comprobante: Omit<BorradorFactura, "items">;
  proveedor: { id: string; razonSocial: string } | null;
  lineas: LineaFacturaVistaPrevia[];
  advertencias: AdvertenciaFactura[];
}

/** "A 0006-00983051" -- the printed form of the invoice number. */
export function formatearComprobante(letra: string | null, puntoVenta: string, numero: string): string {
  return `${letra ? `${letra} ` : ""}${puntoVenta.padStart(4, "0")}-${numero.padStart(8, "0")}`;
}

export function mensajeFacturaYaImportada(comprobante: string, registradoEn: Date): string {
  return `La factura ${comprobante} ya se importó el ${registradoEn.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.`;
}
