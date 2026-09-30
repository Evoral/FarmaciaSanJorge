/**
 * Text normalization for the PDF import's match step
 * (docs/specs/importacion-receta-pdf.md, "Pieza 4 -- Match"): lowercase,
 * NFD without diacritics, whitespace collapsed, trimmed. Matching compares
 * the normalized forms EXACTLY -- no fuzzy matching, so a misspelling
 * never matches ("Cafeína" = "cafeina", but "Cafeina" != "Cafeinna").
 *
 * Also the form `fsj.droga_alias.alias_normalizado` is stored in
 * (migration 0049), and what the parser uses to recognize its keywords
 * regardless of accents/case. Pure, no runtime dependencies.
 */

/** "  Cloruro   de POTASIO " -> "cloruro de potasio"; "Cafeína" -> "cafeina"; "½ Dosis" -> "½ dosis". */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact comparison of the normalized forms. */
export function coincideNormalizado(a: string, b: string): boolean {
  return normalizarTexto(a) === normalizarTexto(b);
}
