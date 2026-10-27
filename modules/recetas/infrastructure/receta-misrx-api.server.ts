/**
 * HTTP adapter to the MisRx receta API (openspec/specs/importacion-receta-qr/spec.md, "Emisor MisRx"): GETs ONE
 * constant endpoint with the receta's token as the only variable part, and hands back the parsed JSON for the pure
 * mapper (domain/receta-misrx.ts). Same rules as the RCTA adapter (./receta-rcta-api.server.ts): failures are return
 * values, nothing is logged, bodies are capped, no redirects.
 *
 * Classification: the API answers an unknown token with HTTP 404 and `{"detail":"Número de Órden inexistente o no
 * valido"}` (checked 2026-10-27), so only a 404 carrying that JSON means "no such receta"; a bare 404 means the
 * endpoint moved.
 *   - 2xx: not JSON / over the cap / unparseable -> FORMATO_INESPERADO; an empty body -> QR_INVALIDO
 *   - 404 whose JSON body says "inexistente", and 400 / 422 -> QR_INVALIDO
 *   - anything else, network error, timeout, redirect -> RCTA_NO_DISPONIBLE ("the emisor could not be reached")
 */
import "server-only";
import type { CodigoErrorQr } from "../domain/receta-qr";
import { RE_TOKEN_MISRX } from "../domain/receta-misrx";
import { descartarCuerpo, esJson, leerCuerpoAcotado, TIMEOUT_RCTA_MS, type ResultadoConsultaRcta } from "./receta-rcta-api.server";

export const ENDPOINT_MISRX = "https://misrx.com.ar/wsmvd/api/prestacion";

const RE_RECETA_INEXISTENTE = /inexistente/i;
const fallo = (codigo: CodigoErrorQr): ResultadoConsultaRcta => ({ ok: false, codigo });

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
  if (status === 404 && esJson(respuesta)) {
    const texto = await leerCuerpoAcotado(respuesta);
    return fallo(texto !== null && RE_RECETA_INEXISTENTE.test(texto) ? "QR_INVALIDO" : "RCTA_NO_DISPONIBLE");
  }
  await descartarCuerpo(respuesta);
  return fallo(status === 400 || status === 422 ? "QR_INVALIDO" : "RCTA_NO_DISPONIBLE");
}

/** `token` must already be the canonical lowercase dashed UUID from `extraerTokenMisrx` (re-checked, sent exactly as given). */
export async function consultarRecetaMisrx(token: string): Promise<ResultadoConsultaRcta> {
  if (!RE_TOKEN_MISRX.test(token)) return fallo("QR_INVALIDO");
  try {
    const respuesta = await fetch(`${ENDPOINT_MISRX}?token=${token}`, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_RCTA_MS),
    });
    return await clasificar(respuesta);
  } catch {
    return fallo("RCTA_NO_DISPONIBLE");
  }
}
