/**
 * Pure domain-rule and input-validation tests for FASE 3 point 3.9
 * (modules/directores-tecnicos/**) -- no database, no mocked transaction.
 * Same pattern as tests/unit/parametros-validacion.test.ts: directly
 * exercises modules/directores-tecnicos/domain/designacion.ts's pure
 * functions and the two commands' zod schemas (exported for exactly this
 * purpose, same convention as modules/farmacia/application/editar-datos-tenant.ts's
 * `editarDatosTenantInput`).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { isoDate, validarRangoVigencia } from "@/modules/directores-tecnicos/domain/designacion";
import { designarDirectorTecnicoInput } from "@/modules/directores-tecnicos/application/designar-director-tecnico";
import { cesarDesignacionInput } from "@/modules/directores-tecnicos/application/cesar-designacion";

describe("domain/designacion: isoDate", () => {
  it.each(["2026-01-01", "2026-12-31", "2000-01-01"])("accepts %s", (valor) => {
    expect(isoDate.safeParse(valor).success).toBe(true);
  });

  it.each([
    ["2026-1-1", "not zero-padded"],
    ["01-01-2026", "wrong field order"],
    ["2026/01/01", "wrong separator"],
    ["", "empty"],
    ["not-a-date", "not a date shape at all"],
    ["2026-01-01T00:00:00Z", "carries a time component"],
  ])("rejects %s (%s)", (valor) => {
    expect(isoDate.safeParse(valor).success).toBe(false);
  });
});

describe("domain/designacion: validarRangoVigencia", () => {
  it("returns null when vigenteHasta is null (open-ended designacion)", () => {
    expect(validarRangoVigencia("2026-01-01", null)).toBeNull();
  });

  it("returns null when vigenteHasta equals vigenteDesde (same-day cese)", () => {
    expect(validarRangoVigencia("2026-01-01", "2026-01-01")).toBeNull();
  });

  it("returns null when vigenteHasta is after vigenteDesde", () => {
    expect(validarRangoVigencia("2026-01-01", "2026-06-30")).toBeNull();
  });

  it("returns a Spanish error message when vigenteHasta is before vigenteDesde", () => {
    const error = validarRangoVigencia("2026-06-30", "2026-01-01");
    expect(error).toBeTypeOf("string");
    expect(error).toMatch(/no puede ser anterior/i);
  });
});

describe("designarDirectorTecnicoInput zod schema", () => {
  const base = {
    usuarioId: randomUUID(),
    caracter: "TITULAR",
    matricula: "MAT-1",
    vigenteDesde: "2026-01-01",
  };

  it("accepts a full valid input, with expedienteDesignacion omitted", () => {
    expect(designarDirectorTecnicoInput.safeParse(base).success).toBe(true);
  });

  it("accepts a valid input with expedienteDesignacion present", () => {
    expect(designarDirectorTecnicoInput.safeParse({ ...base, expedienteDesignacion: "EXP-123" }).success).toBe(true);
  });

  it("accepts caracter SUPLENTE", () => {
    expect(designarDirectorTecnicoInput.safeParse({ ...base, caracter: "SUPLENTE" }).success).toBe(true);
  });

  it.each([
    ["usuarioId", "not-a-uuid"],
    ["caracter", "INVALIDO"],
    ["matricula", ""],
    ["vigenteDesde", "01/01/2026"],
  ])("rejects when %s is invalid (%s)", (field, value) => {
    const result = designarDirectorTecnicoInput.safeParse({ ...base, [field]: value });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (matricula)", () => {
    const { matricula: _matricula, ...withoutMatricula } = base;
    void _matricula;
    expect(designarDirectorTecnicoInput.safeParse(withoutMatricula).success).toBe(false);
  });

  it("rejects an expedienteDesignacion longer than 200 characters", () => {
    const result = designarDirectorTecnicoInput.safeParse({ ...base, expedienteDesignacion: "x".repeat(201) });
    expect(result.success).toBe(false);
  });
});

describe("cesarDesignacionInput zod schema", () => {
  const base = {
    designacionId: randomUUID(),
    vigenteHasta: "2026-06-30",
    motivoCese: "renuncia",
  };

  it("accepts a full valid input", () => {
    expect(cesarDesignacionInput.safeParse(base).success).toBe(true);
  });

  it.each([
    ["designacionId", "not-a-uuid"],
    ["vigenteHasta", "30/06/2026"],
    ["motivoCese", ""],
  ])("rejects when %s is invalid (%s)", (field, value) => {
    const result = cesarDesignacionInput.safeParse({ ...base, [field]: value });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field (motivoCese)", () => {
    const { motivoCese: _motivoCese, ...withoutMotivo } = base;
    void _motivoCese;
    expect(cesarDesignacionInput.safeParse(withoutMotivo).success).toBe(false);
  });
});
