/**
 * Unit tests for the response headers computed by next.config.ts (spec P63):
 * every route keeps `Permissions-Policy: camera=()`, and only `/recetas/nuevo`
 * (the QR import's camera) gets `camera=(self)`. Next applies every entry whose
 * `source` matches the path, in order, and the LAST one setting a key wins
 * (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md,
 * "Header Overriding Behavior"). `source` patterns are path-to-regexp; this config
 * only uses the catch-all "/(.*)" and literal paths, so those are all the local
 * matcher understands (Next's compiled path-to-regexp ships no types). A new kind
 * of pattern fails loudly instead of being silently ignored.
 */
import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";

type Entrada = { source: string; headers: { key: string; value: string }[] };

function coincide(source: string, ruta: string): boolean {
  if (source === "/(.*)") return true;
  if (/^\/[a-z0-9/-]*$/.test(source)) return source === ruta;
  throw new Error(`next-config-headers.test.ts: unsupported source pattern ${source}; extend coincide()`);
}

async function cabecerasPara(ruta: string): Promise<Record<string, string>> {
  const entradas = (await nextConfig.headers?.()) as Entrada[];
  const efectivas: Record<string, string> = {};
  for (const { source, headers } of entradas) {
    if (!coincide(source, ruta)) continue;
    for (const { key, value } of headers) efectivas[key] = value;
  }
  return efectivas;
}

const POLITICA_BASE = "camera=(), microphone=(), geolocation=()";

describe("P63: Permissions-Policy per route", () => {
  it("every route other than /recetas/nuevo keeps camera=() (and the other directives)", async () => {
    for (const ruta of ["/", "/recetas", "/recetas/123", "/recetas/123/editar", "/pacientes/nuevo", "/api/health", "/recetas/nuevo/otra"]) {
      expect((await cabecerasPara(ruta))["Permissions-Policy"], ruta).toBe(POLITICA_BASE);
    }
  });

  it("/recetas/nuevo gets camera=(self), keeping microphone and geolocation denied", async () => {
    expect((await cabecerasPara("/recetas/nuevo"))["Permissions-Policy"]).toBe("camera=(self), microphone=(), geolocation=()");
  });

  it("/recetas/nuevo keeps every other hardening header", async () => {
    const nueva = await cabecerasPara("/recetas/nuevo");
    const otra = await cabecerasPara("/recetas");
    const sin = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).filter(([k]) => k !== "Permissions-Policy"));
    expect(sin(nueva)).toEqual(sin(otra));
    expect(nueva["X-Frame-Options"]).toBe("DENY");
    expect(nueva["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("the override is declared AFTER the global entry (last match wins)", async () => {
    const entradas = (await nextConfig.headers?.()) as Entrada[];
    const indiceGlobal = entradas.findIndex((e) => e.headers.some((h) => h.key === "Permissions-Policy") && e.source === "/(.*)");
    const indiceNuevo = entradas.findIndex((e) => e.source === "/recetas/nuevo");
    expect(indiceGlobal).toBeGreaterThanOrEqual(0);
    expect(indiceNuevo).toBeGreaterThan(indiceGlobal);
  });
});
