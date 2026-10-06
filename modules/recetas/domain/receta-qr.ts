/**
 * Pure rules of the receta QR import (importacion-receta-qr spec, R1).
 * The text a USB scanner types (or a camera decodes) is NEVER used as a
 * fetch target: the only thing taken from it is the receta's hash -- a
 * maximal run of exactly 64 hex characters -- which the HTTP adapter then
 * appends to a CONSTANT endpoint. Everything else (scheme, host, path) is
 * ignored, except that a URL on a foreign host is rejected outright so a
 * link pointing elsewhere never reaches the network layer.
 */
import type { AdvertenciaParser, BorradorReceta } from "./receta-pdf-parser";

/** Why a QR read failed. The adapter and the mapper report these; the use case turns them into errors. */
export type CodigoErrorQr = "QR_INVALIDO" | "RCTA_NO_DISPONIBLE" | "FORMATO_INESPERADO";

export const MENSAJES_LECTURA_QR: Readonly<Record<CodigoErrorQr, string>> = {
  QR_INVALIDO: "QR no válido o receta no encontrada",
  RCTA_NO_DISPONIBLE: "No se pudo consultar RCTA, importá el PDF",
  FORMATO_INESPERADO: "RCTA devolvió la receta en un formato inesperado. Importá el PDF.",
};

/** Same draft + notices the PDF parser produces, or a coded failure with its user-facing message. */
export type ResultadoLecturaQr =
  | { ok: true; borrador: BorradorReceta; advertencias: AdvertenciaParser[] }
  | { ok: false; codigo: CodigoErrorQr; mensaje: string };

const HOST_EMISOR = "verumrp.com.ar";
/** A hex run that is neither preceded nor followed by another hex character. */
const RE_HASH = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/gi;
/**
 * A real URL prefix ("https://"); anything else is treated as scanner noise, not as a link.
 * Deliberate narrowing of spec P17: "https:evil.com/<hash>" or "https:/evil.com/<hash>"
 * (no "//") is NOT host-checked and yields the hash. Harmless: the text is never a fetch
 * target; only the hash is used, always against the constant endpoint.
 */
const RE_ESQUEMA_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

function esHostDelEmisor(hostname: string): boolean {
  // An absolute host ("verumrp.com.ar.") is the same host.
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === HOST_EMISOR || host.endsWith(`.${HOST_EMISOR}`);
}

/**
 * The receta hash found in `texto` in its canonical UPPERCASE form (RCTA's
 * decrypter is CASE-SENSITIVE: it answers "Recipe does not exists" to the same
 * hash lowercased, and the QR link prints it uppercase), or `null` when there is none,
 * the candidates disagree (two DIFFERENT 64-hex runs), or the text is a
 * well-formed URL (scheme + "//") on a host other than the emisor's. Lenient
 * on purpose about everything else -- case and the punctuation a scanner with
 * the wrong keyboard layout garbles ("https;--verumrp.com.ar-prescripcion-<hash>",
 * "https:--verumrp.com.ar-..."): without a real "scheme://" prefix the text is
 * not host-checked and only the 64-hex scan applies.
 */
export function extraerHashRcta(texto: string): string | null {
  const limpio = texto.trim();
  if (limpio.length === 0) return null;

  if (RE_ESQUEMA_URL.test(limpio)) {
    let url: URL | null = null;
    try {
      url = new URL(limpio);
    } catch {
      // Looks like a link but does not parse: fall through to the hash scan.
    }
    if (url !== null && url.hostname.length > 0 && !esHostDelEmisor(url.hostname)) return null;
  }

  const hashes = new Set((limpio.match(RE_HASH) ?? []).map((h) => h.toUpperCase()));
  if (hashes.size !== 1) return null;
  return [...hashes][0]!;
}
