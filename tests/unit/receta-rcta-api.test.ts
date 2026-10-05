/**
 * Unit tests for modules/recetas/infrastructure/receta-rcta-api.server.ts
 * (importacion-receta-qr spec, R2 -- cases P18-P25, P64): the HTTP adapter to
 * the RCTA decrypter, with the global `fetch` stubbed (the real API is never
 * called). It returns coded results, never throws, and never logs. The hash
 * and bodies below are fictitious.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { consultarRecetaRcta, ENDPOINT_RCTA, MAX_BYTES_RESPUESTA_RCTA, TIMEOUT_RCTA_MS } from "@/modules/recetas/infrastructure/receta-rcta-api.server";

const HASH = "a1b2c3d4e5f60718".repeat(4);
const URL_ESPERADA = `https://decrypter.verumrp.com.ar/api/RecipeDecryption/WithPrescription?hashedRecipe=${HASH}`;
const JSON_CT = { "content-type": "application/json; charset=utf-8" };
const SECRETO = "CUERPO-CONFIDENCIAL-123";

const fetchMock = vi.fn();
const respuesta = (cuerpo: BodyInit | null, status = 200, headers: Record<string, string> = JSON_CT) => new Response(cuerpo, { status, headers });
const json = (valor: unknown, status = 200) => respuesta(JSON.stringify(valor), status);
const NO_DISPONIBLE = { ok: false, codigo: "RCTA_NO_DISPONIBLE" } as const;
const NO_ENCONTRADA = { ok: false, codigo: "QR_INVALIDO" } as const;
const FORMATO = { ok: false, codigo: "FORMATO_INESPERADO" } as const;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("P18: the request", () => {
  it("GETs ONLY the constant endpoint with the hash, no redirects, no cache, JSON accept and an 8 s timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(json({ emisor: "RCTA" }));
    await consultarRecetaRcta(HASH);
    expect(ENDPOINT_RCTA).toBe("https://decrypter.verumrp.com.ar/api/RecipeDecryption/WithPrescription");
    expect(TIMEOUT_RCTA_MS).toBe(8000);
    expect(timeout).toHaveBeenCalledWith(8000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(URL_ESPERADA);
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store", headers: { accept: "application/json" } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("re-checks the hash: anything that is not 64 hex characters is QR_INVALIDO and never fetched", async () => {
    for (const mala of ["", "abc", `${HASH}a`, HASH.toUpperCase(), `${HASH.slice(0, 63)}/`, `${HASH}&x=1`]) {
      expect(await consultarRecetaRcta(mala)).toEqual(NO_ENCONTRADA);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("P18: a 200 JSON body is returned as parsed JSON, whatever its shape (the mapper judges it)", async () => {
    fetchMock.mockResolvedValueOnce(json({ emisor: "RCTA", numeroReceta: "1" }));
    expect(await consultarRecetaRcta(HASH)).toEqual({ ok: true, json: { emisor: "RCTA", numeroReceta: "1" } });
    fetchMock.mockResolvedValueOnce(json({}));
    expect(await consultarRecetaRcta(HASH)).toEqual({ ok: true, json: {} });
  });
});

describe("P19-P20: the receta does not exist", () => {
  it("P19: a 200 with an empty body is QR_INVALIDO; a literal null is handed to the mapper, which says the same", async () => {
    fetchMock.mockResolvedValueOnce(respuesta(""));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_ENCONTRADA);
    fetchMock.mockResolvedValueOnce(respuesta("  "));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_ENCONTRADA);
    fetchMock.mockResolvedValueOnce(respuesta("null"));
    expect(await consultarRecetaRcta(HASH)).toEqual({ ok: true, json: null });
  });

  it("P20: ONLY 400 and 422 are QR_INVALIDO (the API rejects the hash itself)", async () => {
    for (const estado of [400, 422]) {
      fetchMock.mockResolvedValueOnce(respuesta("nada", estado, { "content-type": "text/plain" }));
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_ENCONTRADA);
      fetchMock.mockResolvedValueOnce(json({ error: "Bad request" }, estado));
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_ENCONTRADA);
    }
  });

  it("P20: any other 4xx (404, 405, 407, 410, 421, 451, ...) means the endpoint moved or is blocked: RCTA_NO_DISPONIBLE, not 'invalid QR'", async () => {
    for (const estado of [404, 405, 407, 410, 421, 451]) {
      fetchMock.mockResolvedValueOnce(respuesta("nada", estado, { "content-type": "text/plain" }));
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
      fetchMock.mockResolvedValueOnce(json({ error: "Not found" }, estado));
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
    }
  });

  it("the real API answers an unknown hash with 500 + {error: 'Recipe does not exists'}: that is QR_INVALIDO, not an outage", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Recipe does not exists" }, 500));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_ENCONTRADA);
    fetchMock.mockResolvedValueOnce(json({ error: "recipe does not exist" }, 500));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_ENCONTRADA);
  });

  it("insurance if RCTA switches to 404: a 404 with the same JSON 'does not exist' body is QR_INVALIDO", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Recipe does not exists" }, 404));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_ENCONTRADA);
    fetchMock.mockResolvedValueOnce(json({ error: "recipe does not exist" }, 404));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_ENCONTRADA);
  });

  it("a 404 WITHOUT that body (other JSON, no body, or a non-JSON content-type) stays RCTA_NO_DISPONIBLE", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Not found" }, 404));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
    fetchMock.mockResolvedValueOnce(respuesta("", 404));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
    fetchMock.mockResolvedValueOnce(respuesta("Recipe does not exists", 404, { "content-type": "text/html" }));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
  });
});

describe("P21-P23: RCTA is not available", () => {
  it("P21: any other 5xx is RCTA_NO_DISPONIBLE, including a 500 whose body is not the 'does not exist' error", async () => {
    for (const estado of [500, 502, 503, 504]) {
      fetchMock.mockResolvedValueOnce(json({ error: "Internal failure" }, estado));
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
    }
    fetchMock.mockResolvedValueOnce(respuesta("Recipe does not exists", 500, { "content-type": "text/html" }));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
    fetchMock.mockResolvedValueOnce(respuesta("", 500));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
  });

  it("408 and 429 are transient: RCTA_NO_DISPONIBLE, not 'not found'", async () => {
    for (const estado of [408, 429]) {
      fetchMock.mockResolvedValueOnce(respuesta("", estado));
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
    }
  });

  it("401 and 403 (an IP block, a WAF or an auth requirement in the future) are an outage, not an invalid QR", async () => {
    for (const estado of [401, 403]) {
      fetchMock.mockResolvedValueOnce(respuesta("nada", estado, { "content-type": "text/plain" }));
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
      fetchMock.mockResolvedValueOnce(json({ error: "Forbidden" }, estado));
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
    }
  });

  it("P22: a timeout, an abort or a network TypeError is RCTA_NO_DISPONIBLE (and does not throw)", async () => {
    const fallos = [new DOMException("The operation timed out.", "TimeoutError"), new DOMException("aborted", "AbortError"), new TypeError("fetch failed")];
    for (const fallo of fallos) {
      fetchMock.mockRejectedValueOnce(fallo);
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
    }
  });

  it("P23: a redirect is not followed (fetch rejects with redirect 'error'), and a 3xx that does come back is RCTA_NO_DISPONIBLE", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause: new Error("unexpected redirect") }));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
    fetchMock.mockResolvedValueOnce(respuesta("", 302, { location: "https://evil.example/x" }));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
  });

  it("a body that fails mid-read is RCTA_NO_DISPONIBLE", async () => {
    const roto = new ReadableStream<Uint8Array>({ pull: (c) => c.error(new TypeError("terminated")) });
    fetchMock.mockResolvedValueOnce(respuesta(roto));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
  });
});

describe("P24-P25: an unexpected response", () => {
  it("P24: a 200 that is not JSON (wrong content-type, missing content-type, invalid JSON) is FORMATO_INESPERADO", async () => {
    fetchMock.mockResolvedValueOnce(respuesta("<html></html>", 200, { "content-type": "text/html" }));
    expect(await consultarRecetaRcta(HASH)).toEqual(FORMATO);
    fetchMock.mockResolvedValueOnce(respuesta("{}", 200, {}));
    expect(await consultarRecetaRcta(HASH)).toEqual(FORMATO);
    fetchMock.mockResolvedValueOnce(respuesta("{no es json", 200));
    expect(await consultarRecetaRcta(HASH)).toEqual(FORMATO);
  });

  it("P24: a JSON content-type with a vendor suffix or charset is accepted", async () => {
    fetchMock.mockResolvedValueOnce(respuesta("{}", 200, { "content-type": "application/problem+json" }));
    expect(await consultarRecetaRcta(HASH)).toEqual({ ok: true, json: {} });
  });

  it("P25: a body over 64 KiB is rejected, and the cap is enforced WHILE reading (an endless stream is cancelled)", async () => {
    expect(MAX_BYTES_RESPUESTA_RCTA).toBe(64 * 1024);
    const cancelado = vi.fn();
    const infinito = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(1024).fill(32)), cancel: cancelado });
    fetchMock.mockResolvedValueOnce(respuesta(infinito));
    expect(await consultarRecetaRcta(HASH)).toEqual(FORMATO);
    expect(cancelado).toHaveBeenCalled();
  });

  it("P25: a declared content-length over the cap is rejected without reading, and a body of exactly 64 KiB is accepted", async () => {
    fetchMock.mockResolvedValueOnce(respuesta("{}", 200, { ...JSON_CT, "content-length": String(MAX_BYTES_RESPUESTA_RCTA + 1) }));
    expect(await consultarRecetaRcta(HASH)).toEqual(FORMATO);
    const relleno = " ".repeat(MAX_BYTES_RESPUESTA_RCTA - 2);
    fetchMock.mockResolvedValueOnce(respuesta(`{}${relleno}`));
    expect(await consultarRecetaRcta(HASH)).toEqual({ ok: true, json: {} });
    fetchMock.mockResolvedValueOnce(respuesta(`{}${relleno} `));
    expect(await consultarRecetaRcta(HASH)).toEqual(FORMATO);
  });

  it("the error body of a 500 is bounded by the same cap: an oversize one is RCTA_NO_DISPONIBLE", async () => {
    fetchMock.mockResolvedValueOnce(respuesta(`{"error":"Recipe does not exists"}${" ".repeat(MAX_BYTES_RESPUESTA_RCTA)}`, 500));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
  });
});

describe("unread bodies are released", () => {
  /** A response whose body stream reports when it is cancelled. */
  function conCuerpoVigilado(estado: number, headers: Record<string, string>) {
    const cancelado = vi.fn();
    const cuerpo = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(8)), cancel: cancelado });
    return { cancelado, respuesta: respuesta(cuerpo, estado, headers) };
  }

  it("408 and 429 cancel the unread body", async () => {
    for (const estado of [408, 429]) {
      const { cancelado, respuesta: r } = conCuerpoVigilado(estado, JSON_CT);
      fetchMock.mockResolvedValueOnce(r);
      expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
      expect(cancelado).toHaveBeenCalledTimes(1);
    }
  });

  it("a 2xx without a JSON content-type cancels the unread body", async () => {
    for (const headers of [{ "content-type": "text/html" }, {}] as Record<string, string>[]) {
      const { cancelado, respuesta: r } = conCuerpoVigilado(200, headers);
      fetchMock.mockResolvedValueOnce(r);
      expect(await consultarRecetaRcta(HASH)).toEqual(FORMATO);
      expect(cancelado).toHaveBeenCalledTimes(1);
    }
  });

  it("a 4xx and an unexpected 5xx without a JSON body still cancel it (existing behavior)", async () => {
    for (const estado of [404, 502]) {
      const { cancelado, respuesta: r } = conCuerpoVigilado(estado, { "content-type": "text/plain" });
      fetchMock.mockResolvedValueOnce(r);
      await consultarRecetaRcta(HASH);
      expect(cancelado).toHaveBeenCalledTimes(1);
    }
  });

  it("a cancel that rejects does not change the result", async () => {
    const cuerpo = new ReadableStream<Uint8Array>({ cancel: () => Promise.reject(new Error("boom")) });
    fetchMock.mockResolvedValueOnce(respuesta(cuerpo, 429));
    expect(await consultarRecetaRcta(HASH)).toEqual(NO_DISPONIBLE);
  });
});

describe("P64: nothing is logged", () => {
  it("neither the hash nor any body reaches the console, whatever happens", async () => {
    const consola = (["log", "info", "warn", "error", "debug", "trace"] as const).map((metodo) => vi.spyOn(console, metodo).mockImplementation(() => undefined));
    const escenarios: Array<() => Response | Promise<Response>> = [
      () => json({ emisor: "RCTA", dato: SECRETO }),
      () => json({ error: SECRETO }, 500),
      () => json({ error: "Recipe does not exists", dato: SECRETO }, 500),
      () => respuesta(`{no es json ${SECRETO}`),
      () => respuesta(SECRETO, 404, { "content-type": "text/plain" }),
      () => Promise.reject(new TypeError(`fetch failed ${HASH}`)),
    ];
    for (const escenario of escenarios) {
      fetchMock.mockImplementationOnce(async () => escenario());
      await consultarRecetaRcta(HASH);
    }
    for (const espia of consola) expect(espia).not.toHaveBeenCalled();
  });

  it("a failure result carries only the code: no message, cause or text that could echo the hash or the body", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed ${HASH}`, { cause: new Error(HASH) }));
    const r = await consultarRecetaRcta(HASH);
    expect(Object.keys(r)).toEqual(["ok", "codigo"]);
    expect(JSON.stringify(r)).not.toContain(HASH);
  });
});
