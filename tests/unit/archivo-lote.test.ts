/**
 * Unit tests for `modules/archivo/domain/lote-archivo.ts` (FASE 12, M15,
 * points 12.1-12.3). Pure functions, no mocks needed.
 */
import { describe, it, expect } from "vitest";
import {
  esRecetaElegibleParaArchivo,
  puedeSolicitarDestruccion,
  puedeAutorizarDestruccion,
  puedeRegistrarDestruccion,
  estaDestruido,
  validarAutorizacionDestruccion,
  validarRegistroDestruccion,
} from "@/modules/archivo/domain/lote-archivo";

// `calcularVencimientoLote`/`estaPlazoCumplido`/`elegirPlazoAnios` were
// removed from this module -- `vencimiento`/`plazoCumplido` are now
// computed only in SQL (`archivo-repository.ts`'s `vencimientoFragment`),
// covered by that file's own tests/DB test instead of here.

describe("esRecetaElegibleParaArchivo", () => {
  const base = { estado: "ENTREGADA", recetaFisicaRecibida: true, loteArchivoId: null, fechaIngreso: "2024-06-15" };

  it("eligible: ENTREGADA/ANULADA, receta fisica recibida, sin lote, dentro del periodo", () => {
    expect(esRecetaElegibleParaArchivo(base, "2024-06-01", "2024-06-30")).toBe(true);
    expect(esRecetaElegibleParaArchivo({ ...base, estado: "ANULADA" }, "2024-06-01", "2024-06-30")).toBe(true);
  });

  it("not eligible: already has a lote assigned", () => {
    expect(esRecetaElegibleParaArchivo({ ...base, loteArchivoId: "lote-1" }, "2024-06-01", "2024-06-30")).toBe(false);
  });

  it("not eligible: receta fisica not received (even if ANULADA)", () => {
    expect(esRecetaElegibleParaArchivo({ ...base, estado: "ANULADA", recetaFisicaRecibida: false }, "2024-06-01", "2024-06-30")).toBe(false);
  });

  it("not eligible: wrong estado", () => {
    expect(esRecetaElegibleParaArchivo({ ...base, estado: "EN_PREPARACION" }, "2024-06-01", "2024-06-30")).toBe(false);
  });

  it("not eligible: fecha_ingreso outside the periodo", () => {
    expect(esRecetaElegibleParaArchivo(base, "2024-07-01", "2024-07-31")).toBe(false);
  });
});

describe("step availability", () => {
  it("puedeSolicitarDestruccion only from PLAZO_CUMPLIDO", () => {
    expect(puedeSolicitarDestruccion("PLAZO_CUMPLIDO")).toBe(true);
    expect(puedeSolicitarDestruccion("EN_ARCHIVO")).toBe(false);
    expect(puedeSolicitarDestruccion("DESTRUCCION_SOLICITADA")).toBe(false);
  });

  it("puedeAutorizarDestruccion only from DESTRUCCION_SOLICITADA", () => {
    expect(puedeAutorizarDestruccion("DESTRUCCION_SOLICITADA")).toBe(true);
    expect(puedeAutorizarDestruccion("PLAZO_CUMPLIDO")).toBe(false);
  });

  it("puedeRegistrarDestruccion only from DESTRUCCION_AUTORIZADA", () => {
    expect(puedeRegistrarDestruccion("DESTRUCCION_AUTORIZADA")).toBe(true);
    expect(puedeRegistrarDestruccion("DESTRUCCION_SOLICITADA")).toBe(false);
  });

  it("estaDestruido only for DESTRUIDO", () => {
    expect(estaDestruido("DESTRUIDO")).toBe(true);
    expect(estaDestruido("DESTRUCCION_AUTORIZADA")).toBe(false);
  });
});

describe("validarAutorizacionDestruccion", () => {
  it("rejects a blank expediente", () => {
    const r = validarAutorizacionDestruccion({ expedienteAutorizacion: "   ", fechaAutorizacion: "2026-06-01", jornadaActual: "2026-06-01" });
    expect(r.ok).toBe(false);
  });

  it("rejects a future fechaAutorizacion", () => {
    const r = validarAutorizacionDestruccion({ expedienteAutorizacion: "EXP-1", fechaAutorizacion: "2026-06-02", jornadaActual: "2026-06-01" });
    expect(r.ok).toBe(false);
  });

  it("accepts a non-blank expediente with a non-future date", () => {
    const r = validarAutorizacionDestruccion({ expedienteAutorizacion: "EXP-1", fechaAutorizacion: "2026-06-01", jornadaActual: "2026-06-01" });
    expect(r.ok).toBe(true);
  });
});

describe("validarRegistroDestruccion", () => {
  it("rejects a future fechaDestruccion", () => {
    const r = validarRegistroDestruccion({ fechaDestruccion: "2026-06-02", fechaAutorizacion: "2026-06-01", jornadaActual: "2026-06-01" });
    expect(r.ok).toBe(false);
  });

  it("rejects fechaDestruccion before fechaAutorizacion", () => {
    const r = validarRegistroDestruccion({ fechaDestruccion: "2026-05-31", fechaAutorizacion: "2026-06-01", jornadaActual: "2026-06-05" });
    expect(r.ok).toBe(false);
  });

  it("accepts fechaDestruccion on/after fechaAutorizacion and not future", () => {
    const r = validarRegistroDestruccion({ fechaDestruccion: "2026-06-01", fechaAutorizacion: "2026-06-01", jornadaActual: "2026-06-01" });
    expect(r.ok).toBe(true);
  });
});
