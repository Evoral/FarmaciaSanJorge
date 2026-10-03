/**
 * `href` with one query param set (or removed when `valor` is empty) and `page` dropped: what an autocomplete
 * navigates to when it applies a pick or a search to a list. Pure, works on relative hrefs.
 */
export function hrefConParam(href: string, param: string, valor: string): string {
  const url = new URL(href, "http://local");
  if (valor) url.searchParams.set(param, valor);
  else url.searchParams.delete(param);
  url.searchParams.delete("page");
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}
