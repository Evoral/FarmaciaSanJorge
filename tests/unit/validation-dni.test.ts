import { describe, it, expect } from "vitest";
import { normalizarDni, dniValido, MENSAJE_DNI_INVALIDO } from "@/shared/validation/dni";

describe("shared/validation/dni", () => {
  describe("normalizarDni", () => {
    it("strips dots, spaces and dashes", () => {
      expect(normalizarDni("12.345.678")).toBe("12345678");
      expect(normalizarDni("12 345-678")).toBe("12345678");
    });
  });

  describe("dniValido", () => {
    it("accepts 7 and 8 digits", () => {
      expect(dniValido("4123456")).toBe(true);
      expect(dniValido("12345678")).toBe(true);
    });

    it("rejects 6 digits, 9 digits, empty string and letters", () => {
      expect(dniValido("123456")).toBe(false);
      expect(dniValido("123456789")).toBe(false);
      expect(dniValido("")).toBe(false);
      expect(dniValido("1234567a")).toBe(false);
      expect(dniValido("abcdefgh")).toBe(false);
    });
  });

  describe("MENSAJE_DNI_INVALIDO", () => {
    it("is exactly 'El DNI debe tener 7 u 8 dígitos.'", () => {
      expect(MENSAJE_DNI_INVALIDO).toBe("El DNI debe tener 7 u 8 dígitos.");
    });
  });
});
