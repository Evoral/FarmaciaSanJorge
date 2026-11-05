/**
 * Unit tests for `modules/medicos/domain/medico.ts` (FASE 4 point 4.4):
 * matrícula normalization (trim/collapse-whitespace/uppercase), which is
 * what makes `uq_medico_matricula_vigente` actually catch
 * equivalent-but-differently-typed matrículas -- and, since migration 0049
 * (DP-23 resolved), the matrícula's jurisdiction.
 */
import { describe, it, expect } from "vitest";
import { formatMatricula, jurisdiccionMatricula, matriculaString, normalizarMatricula } from "@/modules/medicos/domain/medico";
import { crearMedicoInput } from "@/modules/medicos/application/crear-medico";

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

describe("jurisdiccionMatricula (DP-23, migration 0049)", () => {
  it("accepts PROVINCIAL and NACIONAL only", () => {
    expect(jurisdiccionMatricula.safeParse("PROVINCIAL").success).toBe(true);
    expect(jurisdiccionMatricula.safeParse("NACIONAL").success).toBe(true);
    expect(jurisdiccionMatricula.safeParse("").success).toBe(false);
    expect(jurisdiccionMatricula.safeParse("MUNICIPAL").success).toBe(false);
  });

  it("formatMatricula uses the MP/MN shorthand", () => {
    expect(formatMatricula("PROVINCIAL", "1234")).toBe("MP 1234");
    expect(formatMatricula("NACIONAL", "98765")).toBe("MN 98765");
  });
});

describe("crearMedicoInput: optional text", () => {
  const base = { nombre: "Ana", apellido: "Pérez", matricula: "1234", matriculaJurisdiccion: "PROVINCIAL" as const };

  it("stores null for null, empty and missing especialidad / telefono / direccionRegistrada", () => {
    const vacios = crearMedicoInput.parse({ ...base, especialidad: null, telefono: "", direccionRegistrada: undefined });
    expect(vacios.especialidad).toBeNull();
    expect(vacios.telefono).toBeNull();
    expect(vacios.direccionRegistrada).toBeNull();
  });

  it("keeps trimmed text", () => {
    expect(crearMedicoInput.parse({ ...base, telefono: "  261 555 0000 " }).telefono).toBe("261 555 0000");
  });
});
