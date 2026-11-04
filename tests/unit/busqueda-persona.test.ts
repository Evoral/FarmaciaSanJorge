import { describe, it, expect } from "vitest";
import { palabrasBusquedaPersona } from "@/shared/db/busqueda-persona";

describe("palabrasBusquedaPersona (shared/db/busqueda-persona)", () => {
  describe("empty and blank inputs", () => {
    it("returns an empty array for empty string", () => {
      expect(palabrasBusquedaPersona("")).toEqual([]);
    });

    it("returns an empty array for null", () => {
      expect(palabrasBusquedaPersona(null)).toEqual([]);
    });

    it("returns an empty array for undefined", () => {
      expect(palabrasBusquedaPersona(undefined)).toEqual([]);
    });

    it("returns an empty array for spaces only", () => {
      expect(palabrasBusquedaPersona("   ")).toEqual([]);
    });

    it("returns an empty array for mixed whitespace characters", () => {
      expect(palabrasBusquedaPersona(" \t \r\n  ")).toEqual([]);
    });
  });

  describe("split on whitespace", () => {
    it("splits standard two-word names", () => {
      expect(palabrasBusquedaPersona("juan perez")).toEqual(["juan", "perez"]);
    });

    it("collapses multiple consecutive spaces and trims edges", () => {
      expect(palabrasBusquedaPersona("   juan    perez   ")).toEqual(["juan", "perez"]);
    });

    it("splits on tabs and newlines", () => {
      expect(palabrasBusquedaPersona("juan\tperez\nmaria")).toEqual(["juan", "perez", "maria"]);
    });

    it("handles single-word search", () => {
      expect(palabrasBusquedaPersona("perez")).toEqual(["perez"]);
    });
  });

  describe("100-character cap", () => {
    it("caps long single word to 100 characters", () => {
      const longInput = "a".repeat(120);
      const result = palabrasBusquedaPersona(longInput);
      expect(result).toEqual(["a".repeat(100)]);
      expect(result[0]).toHaveLength(100);
    });

    it("trims before capping at 100 characters", () => {
      const input = "   " + "b".repeat(105) + "   ";
      const result = palabrasBusquedaPersona(input);
      expect(result).toEqual(["b".repeat(100)]);
    });

    it("truncates multi-word input beyond 100 characters", () => {
      const prefix = "palabra "; // 8 chars
      const input = prefix + "c".repeat(150);
      const result = palabrasBusquedaPersona(input);
      expect(result).toEqual(["palabra", "c".repeat(92)]);
      expect(result[0].length + 1 + result[1].length).toBe(100);
    });
  });

  describe("LIKE wildcards escaping (% _ \\)", () => {
    it("escapes percent sign (%)", () => {
      expect(palabrasBusquedaPersona("100%")).toEqual(["100\\%"]);
    });

    it("escapes underscore (_)", () => {
      expect(palabrasBusquedaPersona("juan_perez")).toEqual(["juan\\_perez"]);
    });

    it("escapes backslash (\\)", () => {
      expect(palabrasBusquedaPersona("foo\\bar")).toEqual(["foo\\\\bar"]);
    });

    it("escapes all three wildcards combined", () => {
      expect(palabrasBusquedaPersona("% _ \\")).toEqual(["\\%", "\\_", "\\\\"]);
      expect(palabrasBusquedaPersona("foo%bar_baz\\qux")).toEqual(["foo\\%bar\\_baz\\\\qux"]);
    });
  });
});
