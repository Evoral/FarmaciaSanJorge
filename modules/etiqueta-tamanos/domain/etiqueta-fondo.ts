/**
 * Pure domain rules for the configurable red background on the preparado's etiqueta
 * (`fsj.etiqueta_hoja`, migration 0130).
 *
 * Some preparation types legally require a red etiqueta (e.g. external use: cremas).
 * The farmacia can configure which formas farmacéuticas print with a red background,
 * and choose ONE red tone from 5 fixed options with contrast ratio >= 4.5:1 against
 * black text.
 */
import type { FormaFarmaceutica } from "@/modules/recetas/domain/receta";

export interface TonoFondoRojo {
  readonly key: string;
  readonly label: string;
  readonly hex: string;
}

/** The 5 tones, light to strong; black text keeps >= 4.5:1 on each (17.2, 14.5, 11.1, 7.6, 5.6). */
export const TONOS_FONDO_ROJO = [
  { key: "pastel", label: "Rojo pastel", hex: "#fee2e2" },
  { key: "tenue", label: "Rojo tenue", hex: "#fecaca" },
  { key: "suave", label: "Rojo suave", hex: "#fca5a5" },
  { key: "medio", label: "Rojo medio", hex: "#f87171" },
  { key: "intenso", label: "Rojo intenso", hex: "#ef4444" },
] as const satisfies readonly TonoFondoRojo[];

export type TonoFondoRojoKey = (typeof TONOS_FONDO_ROJO)[number]["key"];

/** The keys, as a tuple for zod and the DB CHECK (migration 0130). */
export const TONOS_FONDO_ROJO_KEYS = ["pastel", "tenue", "suave", "medio", "intenso"] as const satisfies readonly TonoFondoRojoKey[];

export const TONO_FONDO_ROJO_PREDETERMINADO: TonoFondoRojoKey = "pastel";

export interface FondoEtiquetaConfig {
  formasFondoRojo: FormaFarmaceutica[];
  tonoFondoRojo: TonoFondoRojoKey;
}

export const FONDO_ETIQUETA_PREDETERMINADO: FondoEtiquetaConfig = {
  formasFondoRojo: [],
  tonoFondoRojo: TONO_FONDO_ROJO_PREDETERMINADO,
};

export function esTonoFondoRojoValido(key: string): key is TonoFondoRojoKey {
  return TONOS_FONDO_ROJO.some((t) => t.key === key);
}

/**
 * THE rule: the background of an etiqueta of `forma` -- the configured tone when that forma prints red, else `null`
 * (white). Every screen and the PDF ask this one function; `config` null = not read (no print permission).
 */
export function colorFondoEtiqueta(forma: string | null | undefined, config: FondoEtiquetaConfig | null): string | null {
  if (!forma || !config || !config.formasFondoRojo.some((f) => f === forma)) return null;
  return (TONOS_FONDO_ROJO.find((t) => t.key === config.tonoFondoRojo) ?? TONOS_FONDO_ROJO[0]).hex;
}
