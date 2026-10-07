/**
 * Suggests the clase (migration 0063) of a product from its name -- the
 * droga form's default and the supplier invoice import's "Crear" action.
 * Keyword rules over the normalized text; it only SUGGESTS: the user
 * always sees and confirms the clase (lactose or microcrystalline
 * cellulose can be the active ingredient of a formula). Once a product is
 * in the catalog its clase comes from there, never from this.
 */
import { normalizarTexto } from "./normalizar";
import type { ClaseDroga } from "./droga";

export interface SugerenciaClase {
  clase: Exclude<ClaseDroga, "DROGA">;
  /** The keyword that matched, as written in the rule ("capsula"), to show why. */
  motivo: string;
}

/** Order matters: the first matching rule wins ("frasco de alcohol" is a MATERIAL). */
const REGLAS: readonly { clase: SugerenciaClase["clase"]; palabras: readonly string[] }[] = [
  {
    clase: "MATERIAL",
    palabras: ["capsula", "capsulas", "caps", "gelatina dura", "envase", "frasco", "pote", "tapa", "gotero", "sobre", "blister", "etiqueta"],
  },
  {
    clase: "EXCIPIENTE",
    palabras: [
      "excipiente",
      "alcohol",
      "glicerina",
      "glicerol",
      "vaselina",
      "propilenglicol",
      "polietilenglicol",
      "lactosa",
      "almidon",
      "celulosa microcristalina",
      "estearato de magnesio",
      "dioxido de silicio",
      "aerosil",
      "talco",
      "manitol",
      "sacarosa",
      "agua purificada",
      "agua destilada",
      "base crema",
      "base gel",
      "crema base",
      "gel base",
      "emulsion base",
    ],
  },
];

/** `null` = no rule matched: it is a DROGA as far as this can tell. */
export function sugerirClase(nombre: string): SugerenciaClase | null {
  const texto = ` ${normalizarTexto(nombre).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  for (const regla of REGLAS) {
    const palabra = regla.palabras.find((p) => texto.includes(` ${p} `));
    if (palabra) return { clase: regla.clase, motivo: palabra };
  }
  return null;
}
