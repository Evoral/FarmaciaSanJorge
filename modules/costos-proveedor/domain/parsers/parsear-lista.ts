/**
 * The supplier sends two Crystal Reports layouts (openspec/specs/costos-proveedor/spec.md R16): the "Lista de
 * medicamentos" (./lista-xlsx-crystal.ts) and the "Listado de precios: Catálogo" (./lista-catalogo.ts). The sheet's
 * header says which one it is; the Catálogo is checked first because its header also has `Descripción` and `Precio`.
 * A sheet with neither header is refused by the Lista de medicamentos parser with a message that names both.
 */
import { esListaCatalogo, parsearListaCatalogo } from "./lista-catalogo";
import { parsearListaCrystal } from "./lista-xlsx-crystal";
import type { FilaCruda, ResultadoParseoLista } from "./lista-xlsx-crystal";

export function parsearLista(filas: readonly FilaCruda[]): ResultadoParseoLista {
  return esListaCatalogo(filas) ? parsearListaCatalogo(filas) : parsearListaCrystal(filas);
}
