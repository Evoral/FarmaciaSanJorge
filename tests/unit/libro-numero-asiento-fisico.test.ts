/**
 * Unit tests for `canonicalizarNumeroAsientoFisico` (FIX 3, jd-fix-agent):
 * trimming + leading-zero stripping so "7"/"07"/" 7" collapse to the SAME
 * canonical string before migration 0035's UNIQUE constraint ever sees it.
 */
import { describe, it, expect } from "vitest";
import { canonicalizarNumeroAsientoFisico } from "@/modules/libro/domain/numero-asiento-fisico";

describe("canonicalizarNumeroAsientoFisico", () => {
  it("trims surrounding whitespace", () => {
    expect(canonicalizarNumeroAsientoFisico("  7  ")).toBe("7");
  });

  it("strips leading zeros from a purely numeric value", () => {
    expect(canonicalizarNumeroAsientoFisico("07")).toBe("7");
    expect(canonicalizarNumeroAsientoFisico("0007")).toBe("7");
  });

  it("collapses '7', '07', and ' 7' to the same canonical value", () => {
    const canonical = canonicalizarNumeroAsientoFisico("7");
    expect(canonicalizarNumeroAsientoFisico("07")).toBe(canonical);
    expect(canonicalizarNumeroAsientoFisico(" 7")).toBe(canonical);
    expect(canonicalizarNumeroAsientoFisico("7 ")).toBe(canonical);
  });

  it("collapses an all-zero numeric value to a single '0', never an empty string", () => {
    expect(canonicalizarNumeroAsientoFisico("0")).toBe("0");
    expect(canonicalizarNumeroAsientoFisico("00")).toBe("0");
    expect(canonicalizarNumeroAsientoFisico("000")).toBe("0");
  });

  it("keeps a non-purely-numeric value as trimmed text, verbatim", () => {
    expect(canonicalizarNumeroAsientoFisico("12-bis")).toBe("12-bis");
    expect(canonicalizarNumeroAsientoFisico("  12-bis  ")).toBe("12-bis");
    expect(canonicalizarNumeroAsientoFisico("007-A")).toBe("007-A");
  });
});
