/** openspec/changes/lector-qr-configurable (P83): how the farmacia and equipo levels resolve the panel's mode. */
import { describe, expect, it } from "vitest";
import { parseModoLectorQr, resolverModoLectorQr } from "@/modules/recetas/domain/modo-lector-qr";

describe("parseModoLectorQr", () => {
  it.each(["CAMARA", "LECTOR"] as const)("accepts %s", (valor) => {
    expect(parseModoLectorQr(valor)).toBe(valor);
  });

  it.each([null, undefined, "", "FARMACIA", "camara", " LECTOR", "OTRO"])("ignores %j", (valor) => {
    expect(parseModoLectorQr(valor)).toBeNull();
  });
});

describe("resolverModoLectorQr", () => {
  it.each([
    // [farmacia, equipo, esperado]
    ["CAMARA", null, "CAMARA"],
    ["LECTOR", null, "LECTOR"],
    ["LECTOR", "FARMACIA", "LECTOR"],
    ["LECTOR", "CAMARA", "CAMARA"],
    ["CAMARA", "LECTOR", "LECTOR"],
    [null, "LECTOR", "LECTOR"],
    [null, null, "CAMARA"],
    [null, "FARMACIA", "CAMARA"],
    ["basura", null, "CAMARA"],
    ["LECTOR", "basura", "LECTOR"],
  ])("farmacia %j + equipo %j -> %s", (farmacia, equipo, esperado) => {
    expect(resolverModoLectorQr({ farmacia, equipo })).toBe(esperado);
  });
});
