/**
 * Insumos de la preparación (migration 0110, openspec/specs/insumos-preparacion/spec.md): next to the excipiente, the
 * "Material" (one droga of clase MATERIAL, e.g. the cápsula type) and any number of "insumos adicionales" (drogas of
 * clase EXCIPIENTE or MATERIAL). Pure rules shared by the toma workspace and the use cases. No I/O.
 */
import { formatNumero } from "@/shared/format/cantidad";

export const TIPOS_INSUMO = ["MATERIAL", "ADICIONAL"] as const;
export type TipoInsumo = (typeof TIPOS_INSUMO)[number];

export type ClaseDroga = "DROGA" | "EXCIPIENTE" | "MATERIAL";

/** I2/I6: MATERIAL takes a droga of clase MATERIAL; ADICIONAL one of clase EXCIPIENTE or MATERIAL; never a DROGA. */
export function claseAdmitida(tipo: TipoInsumo, clase: ClaseDroga): boolean {
  return tipo === "MATERIAL" ? clase === "MATERIAL" : clase === "EXCIPIENTE" || clase === "MATERIAL";
}

/** How the messages name an insumo of `tipo`. */
export function nombreTipoInsumo(tipo: TipoInsumo): string {
  return tipo === "MATERIAL" ? "material" : "insumo";
}

/** The first droga id that appears twice among `drogaIds` (nulls ignored), or `null` (I8). */
export function drogaRepetida(drogaIds: readonly (string | null | undefined)[]): string | null {
  const vistas = new Set<string>();
  for (const id of drogaIds) {
    if (!id) continue;
    if (vistas.has(id)) return id;
    vistas.add(id);
  }
  return null;
}

/** I3: the Material row's pre-filled quantity -- the ítem's number of cápsulas when its forma is CAPSULA, else `null`. */
export function cantidadCapsulas(item: { formaFarmaceutica: string; cantidadUnidades: number }): string | null {
  return item.formaFarmaceutica === "CAPSULA" && item.cantidadUnidades > 0 ? String(item.cantidadUnidades) : null;
}

/** `insumo_preparacion.texto varchar(120)`. */
export const TEXTO_INSUMO_MAX = 120;

/** The text an insumo carries ("Aerosil 0,5 g"), like the excipiente's fórmula text. */
export function textoInsumo(drogaNombre: string, cantidad: string, unidadSimbolo: string): string {
  return `${drogaNombre} ${formatNumero(cantidad)} ${unidadSimbolo}`.slice(0, TEXTO_INSUMO_MAX);
}
