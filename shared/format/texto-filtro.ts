/**
 * A query param echoed into a generated document (the "Filtros:" line of a PDF export): control characters (line
 * breaks, tabs) become spaces and the text is capped, so a crafted URL can not reshape the document's header
 * (security audit P4-02). Display only -- the filter itself is validated by the use case's zod schema.
 */
const MAX_TEXTO_FILTRO = 60;

export function textoDeFiltro(valor: string | null | undefined): string {
  const limpio = (valor ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return limpio.length > MAX_TEXTO_FILTRO ? `${limpio.slice(0, MAX_TEXTO_FILTRO)}…` : limpio;
}
