/**
 * HTTP adapter to the RCTA decrypter (importacion-receta-qr spec, R2): the
 * only place the QR import touches the network. It GETs ONE constant endpoint
 * with the receta's hash as the only variable part -- never a URL taken from
 * the scanned text -- and hands back the parsed JSON for the pure mapper to judge.
 *
 * Failures are RETURN VALUES (`{ ok: false, codigo }`), never exceptions and
 * never carrying a `cause`: the error pipeline logs what it catches, and an
 * undici cause could hold the request URL (= the hash). Nothing in this file
 * logs; the hash and the bodies are patient-adjacent data and never leave it.
 *
 * Classification (the decrypter answers an unknown hash with HTTP 500 and
 * `{"error":"Recipe does not exists"}`, so a bare 404 means the endpoint moved, not
 * "no such receta"; a 404 carrying that same JSON body is read as "no such receta"):
 *   - 2xx: not JSON / over the cap / unparseable -> FORMATO_INESPERADO; an empty body -> QR_INVALIDO
 *   - 500 or 404 whose JSON body matches /recipe does not exist/i, and ONLY 400 and 422 -> QR_INVALIDO
 *   - every other 4xx (401/403: an IP block, a WAF or a future auth requirement; any other 404, 405, 410, 451, 408, 429, ...),
 *     any other 5xx or status, network error, timeout, redirect -> RCTA_NO_DISPONIBLE
 */
import "server-only";
import type { CodigoErrorQr } from "../domain/receta-qr";

export const ENDPOINT_RCTA = "https://decrypter.verumrp.com.ar/api/RecipeDecryption/WithPrescription";
export const TIMEOUT_RCTA_MS = 8000;
/** Applies to the receta body and to error bodies alike. */
export const MAX_BYTES_RESPUESTA_RCTA = 64 * 1024;

export type ResultadoConsultaRcta = { ok: true; json: unknown } | { ok: false; codigo: CodigoErrorQr };

/** The decrypter is CASE-SENSITIVE (the lowercased hash is "Recipe does not exists"): only the canonical UPPERCASE form is sent. */
const RE_HASH = /^[0-9A-F]{64}$/;
const RE_CONTENT_TYPE_JSON = /^application\/(?:[a-z0-9.+-]+\+)?json\s*(?:;|$)/i;
const RE_RECETA_INEXISTENTE = /recipe does not exist/i;
/** The only statuses that mean "the API judged the hash itself bad"; every other 4xx (404, 410, 451, ...) says the endpoint moved or is blocked. */
const STATUS_HASH_RECHAZADO: ReadonlySet<number> = new Set([400, 422]);
/** The statuses whose JSON body is inspected for the "does not exist" error: the real 500, plus 404 as insurance if RCTA switches to it. */
const STATUS_CON_CUERPO_RECETA_INEXISTENTE: ReadonlySet<number> = new Set([500, 404]);

const fallo = (codigo: CodigoErrorQr): ResultadoConsultaRcta => ({ ok: false, codigo });

/** The body as text, or `null` when it exceeds the cap (read as a stream and cancelled at the cap, so a huge or endless body is never buffered). */
async function leerCuerpoAcotado(respuesta: Response): Promise<string | null> {
  const declarado = Number(respuesta.headers.get("content-length"));
  const lector = respuesta.body?.getReader();
  if (!lector) return "";
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_RESPUESTA_RCTA) {
    await lector.cancel().catch(() => undefined);
    return null;
  }
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES_RESPUESTA_RCTA) {
      await lector.cancel().catch(() => undefined);
      return null;
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos).toString("utf8");
}

const esJson = (respuesta: Response): boolean => RE_CONTENT_TYPE_JSON.test(respuesta.headers.get("content-type")?.trim() ?? "");

/** Releases the connection of a body that will not be read. */
const descartarCuerpo = (respuesta: Response): Promise<void> => (respuesta.body?.cancel() ?? Promise.resolve()).catch(() => undefined);

async function clasificar(respuesta: Response): Promise<ResultadoConsultaRcta> {
  const { status } = respuesta;
  if (status >= 200 && status < 300) {
    if (!esJson(respuesta)) {
      await descartarCuerpo(respuesta);
      return fallo("FORMATO_INESPERADO");
    }
    const texto = await leerCuerpoAcotado(respuesta);
    if (texto === null) return fallo("FORMATO_INESPERADO");
    if (texto.trim() === "") return fallo("QR_INVALIDO");
    try {
      return { ok: true, json: JSON.parse(texto) as unknown };
    } catch {
      return fallo("FORMATO_INESPERADO");
    }
  }

  if (STATUS_CON_CUERPO_RECETA_INEXISTENTE.has(status) && esJson(respuesta)) {
    const texto = await leerCuerpoAcotado(respuesta);
    return fallo(texto !== null && RE_RECETA_INEXISTENTE.test(texto) ? "QR_INVALIDO" : "RCTA_NO_DISPONIBLE");
  }
  await descartarCuerpo(respuesta);
  return fallo(STATUS_HASH_RECHAZADO.has(status) ? "QR_INVALIDO" : "RCTA_NO_DISPONIBLE");
}

/** `hash` must already be the canonical UPPERCASE 64-hex hash from `extraerHashRcta` (re-checked here, not normalized: it is the only thing that varies in the request and is sent exactly as given). */
export async function consultarRecetaRcta(hash: string): Promise<ResultadoConsultaRcta> {
  if (!RE_HASH.test(hash)) return fallo("QR_INVALIDO");
  try {
    const respuesta = await fetch(`${ENDPOINT_RCTA}?hashedRecipe=${hash}`, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_RCTA_MS),
    });
    return await clasificar(respuesta);
  } catch {
    // Network error, timeout/abort, redirect, a body that broke mid-read: all "RCTA could not be reached".
    return fallo("RCTA_NO_DISPONIBLE");
  }
}
