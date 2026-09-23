/**
 * `mensajeParaCodigoValidacion` (FASE 7 point 7.2): every V1-V9 code the
 * calculator can throw must map to a NON-generic Spanish message, and the
 * mapping must be exhaustive -- a code missing from the table would
 * silently fall back to the generic message, which is exactly the bug this
 * test is meant to catch (it FAILS if a V-code is ever removed from
 * `MENSAJES_VALIDACION_FICHA` without removing it from the calculator too).
 */
import { describe, it, expect } from "vitest";
import { mensajeParaCodigoValidacion, MENSAJES_VALIDACION_FICHA } from "@/modules/elaboracion/domain/mensajes-validacion";

const CODIGOS_V1_A_V9 = ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"];

describe("mensajeParaCodigoValidacion", () => {
  for (const codigo of CODIGOS_V1_A_V9) {
    it(`maps ${codigo} to a distinct, non-empty Spanish message`, () => {
      const mensaje = mensajeParaCodigoValidacion(codigo);
      expect(mensaje.length).toBeGreaterThan(10);
      expect(mensaje).toBe(MENSAJES_VALIDACION_FICHA[codigo]);
    });
  }

  it("every mapped message is unique (no two V-codes share a message)", () => {
    const mensajes = CODIGOS_V1_A_V9.map((c) => mensajeParaCodigoValidacion(c));
    expect(new Set(mensajes).size).toBe(mensajes.length);
  });

  it("V5's message explicitly explains why it surfaces only now (receta alta does not check it)", () => {
    // modules/recetas/domain/receta.ts's own doc comment: "V5 is
    // deliberately NOT checked here" at receta alta time -- the ficha
    // generation error is the FIRST place a user ever sees a V5 rejection,
    // so its message must not read like every other validation.
    expect(mensajeParaCodigoValidacion("V5")).toMatch(/generar la ficha/i);
  });

  it("falls back to a generic (but non-empty) message for an unknown code", () => {
    const mensaje = mensajeParaCodigoValidacion("V99");
    expect(mensaje.length).toBeGreaterThan(0);
    expect(mensaje).not.toBe(mensajeParaCodigoValidacion("V1"));
  });
});
