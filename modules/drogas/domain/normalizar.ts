/**
 * Text normalization for droga names and synonyms
 * (docs/specs/sinonimos-droga.md) and the PDF imports' match step
 * (docs/specs/importacion-receta-pdf.md, "Pieza 4 -- Match"): lowercase,
 * NFD without diacritics, whitespace collapsed, trimmed. Matching compares
 * the normalized forms EXACTLY -- no fuzzy matching, so a misspelling
 * never matches ("Cafeína" = "cafeina", but "Cafeina" != "Cafeinna").
 *
 * Also the form `fsj.droga_alias.alias_normalizado` is stored in
 * (migration 0049), and what the parsers use to recognize their keywords
 * regardless of accents/case. The database twin is
 * `fsj.normalizar_nombre(text)` (migration 0067), which backs the
 * vigente-name unique index and every droga search; it uses `unaccent`, so
 * it also folds a few ligatures this one keeps (ß, æ) -- DB comparisons
 * normalize both sides with the SQL function for that reason.
 * Pure, no runtime dependencies. Lives in `drogas` (it defines what "the
 * same name" means for a droga); `modules/recetas/domain/normalizar.ts`
 * re-exports it for its existing importers.
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
