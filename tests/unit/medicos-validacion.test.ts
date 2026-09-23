/**
 * Unit tests for `modules/medicos/domain/medico.ts` (FASE 4 point 4.4):
 * matrícula normalization (trim/collapse-whitespace/uppercase), which is
 * what makes migration 0007's `uq_medico_matricula_vigente` partial unique
 * index actually catch equivalent-but-differently-typed matrículas (DP-23
 * is unresolved -- no jurisdiction field is invented, see that file's doc
 * comment).
 */
import { describe, it, expect } from "vitest";
import { matriculaString, normalizarMatricula } from "@/modules/medicos/domain/medico";

describe("normalizarMatricula", () => {
  it("trims leading/trailing whitespace", () => {
    expect(normalizarMatricula("  MAT-123  ")).toBe("MAT-123");
  });

  it("collapses runs of internal whitespace to a single space", () => {
    expect(normalizarMatricula("MAT   123")).toBe("MAT 123");
    expect(normalizarMatricula("MAT\t123")).toBe("MAT 123");
  });

  it("uppercases", () => {
    expect(normalizarMatricula("mat-123")).toBe("MAT-123");
  });

  it("DP-23: a dashed-lowercase, an extra-spaced, and an already-normalized matrícula all normalize to the IDENTICAL value -- this is what makes them collide under the DB's partial unique index instead of silently coexisting as 3 different rows", () => {
    const a = normalizarMatricula("mat-123");
    const b = normalizarMatricula("  MAT-123  ");
    const c = normalizarMatricula("MAT-123");
    expect(a).toBe(c);
    expect(b).toBe(c);
  });
});

describe("matriculaString (zod schema)", () => {
  it("rejects an empty matrícula", () => {
    const result = matriculaString.safeParse("   ");
    expect(result.success).toBe(false);
  });

  it("accepts and normalizes a non-empty matrícula", () => {
    const result = matriculaString.safeParse(" mat-123 ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("MAT-123");
  });
});
