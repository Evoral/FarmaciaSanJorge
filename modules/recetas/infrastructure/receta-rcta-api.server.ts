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
 * `{"error":"Recipe does not exists"}`, so a status alone cannot tell "not
 * found" from "down"):
 *   - 2xx: not JSON / over the cap / unparseable -> FORMATO_INESPERADO; an empty body -> QR_INVALIDO
 *   - 500 whose JSON body matches /recipe does not exist/i, and any other 4xx except 401/403/408/429 -> QR_INVALIDO
 *   - 401, 403 (an IP block, a WAF or a future auth requirement is an outage, not an invalid QR), 408, 429,
 *     any other 5xx or status, network error, timeout, redirect -> RCTA_NO_DISPONIBLE
 */
import "server-only";
import type { CodigoErrorQr } from "../domain/receta-qr";

export const ENDPOINT_RCTA = "https://decrypter.verumrp.com.ar/api/RecipeDecryption/WithPrescription";
export const TIMEOUT_RCTA_MS = 8000;
/** Applies to the receta body and to error bodies alike. */
export const MAX_BYTES_RESPUESTA_RCTA = 64 * 1024;

export type ResultadoConsultaRcta = { ok: true; json: unknown } | { ok: false; codigo: CodigoErrorQr };

const RE_HASH = /^[0-9a-f]{64}$/;
const RE_CONTENT_TYPE_JSON = /^application\/(?:[a-z0-9.+-]+\+)?json\s*(?:;|$)/i;
const RE_RECETA_INEXISTENTE = /recipe does not exist/i;

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
  if (status === 401 || status === 403 || status === 408 || status === 429) {
    await descartarCuerpo(respuesta);
    return fallo("RCTA_NO_DISPONIBLE");
  }

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

  if (status === 500 && esJson(respuesta)) {
    const texto = await leerCuerpoAcotado(respuesta);
    return fallo(texto !== null && RE_RECETA_INEXISTENTE.test(texto) ? "QR_INVALIDO" : "RCTA_NO_DISPONIBLE");
  }
  await descartarCuerpo(respuesta);
  return fallo(status >= 400 && status < 500 ? "QR_INVALIDO" : "RCTA_NO_DISPONIBLE");
}

/** `hash` must already be a validated lowercase 64-hex hash (re-checked here: it is the only thing that varies in the request). */
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
