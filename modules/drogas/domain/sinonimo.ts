/**
 * Synonyms of a droga (docs/specs/sinonimos-droga.md). A substance is ONE
 * droga; its other names are synonyms, never separate drogas. Within a
 * tenant, among vigente rows, a normalized name (`./normalizar.ts`) is
 * either one droga's name or one droga's synonym -- never both, never
 * twice. The database enforces it (migration 0067: unique indexes +
 * INV-DRG-002 triggers); this file only words the conflict for the user.
 */

/** Who already holds a normalized name: a vigente droga (by its name) or a vigente synonym of some droga. */
export type ConflictoNombreDroga =
  | { tipo: "droga"; drogaId: string; drogaNombre: string }
  | { tipo: "sinonimo"; drogaId: string; drogaNombre: string; sinonimo: string };

/**
 * Spanish message for a name/synonym that is already taken. `drogaPropiaId`
 * = the droga being created/edited/extended, so its own synonyms read
 * "de esta droga" instead of naming it.
 */
export function mensajeConflictoNombre(conflicto: ConflictoNombreDroga, drogaPropiaId?: string): string {
  if (conflicto.tipo === "droga") {
    return conflicto.drogaId === drogaPropiaId ? `«${conflicto.drogaNombre}» ya es el nombre de esta droga.` : `«${conflicto.drogaNombre}» ya es el nombre de otra droga.`;
  }
  return conflicto.drogaId === drogaPropiaId
    ? `«${conflicto.sinonimo}» ya es otro nombre de esta droga. Quitalo de «Otros nombres» si querés usarlo como nombre principal.`
    : `«${conflicto.sinonimo}» ya es otro nombre de ${conflicto.drogaNombre}.`;
}

/** The synonym as it will be stored for display: trimmed, inner whitespace collapsed, case and accents kept. */
export function limpiarSinonimo(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

export const SINONIMO_MAX_LARGO = 200;
