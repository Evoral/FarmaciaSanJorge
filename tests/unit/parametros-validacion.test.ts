/**
 * Pure validation tests for FASE 3 point 3.10 -- no database, no mocked
 * transaction: directly exercises modules/parametros/domain/parametros-registry.ts's
 * validators and modules/farmacia/application/editar-datos-tenant.ts's zod
 * schema.
 */
import { describe, it, expect } from "vitest";
import { PARAMETROS_REGISTRY } from "@/modules/parametros/domain/parametros-registry";
import { editarDatosTenantInput } from "@/modules/farmacia/application/editar-datos-tenant";

describe("parametros-registry: precision_balanza", () => {
  const validar = PARAMETROS_REGISTRY.precision_balanza.validar;

  it.each(["0.1", "0.01", "0.001"])("accepts %s", (valor) => {
    const result = validar(valor);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["0", "not greater than zero"],
    ["-0.001", "negative"],
    ["1", "power of ten but not in the allowed set"],
    ["0.0001", "power of ten but not in the allowed set"],
    ["abc", "non-numeric"],
    ["", "empty"],
  ])("rejects %s (%s)", (valor) => {
    const result = validar(valor);
    expect(result.ok).toBe(false);
  });

  // FASE 3 point 3.9 review finding N3: exponential notation and
  // whitespace weren't exercised before. Decimal.js parses exponential
  // notation natively (new Decimal("1e-3").equals(new Decimal("0.001")) ===
  // true), so "1e-3" is just another spelling of an already-allowed value
  // and must be ACCEPTED; "1e3" is a valid, finite number (1000) that is
  // simply not in the allowed {0.1, 0.01, 0.001} set, same as "1" already
  // above, so it must be REJECTED -- neither case needed a code change,
  // only test coverage for behavior the implementation already had.
  it("accepts exponential notation '1e-3' (normalizes to 0.001, an allowed value)", () => {
    const result = validar("1e-3");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valor.equals("0.001")).toBe(true);
    }
  });

  it("rejects exponential notation '1e3' (a valid number, 1000, but not in the allowed set)", () => {
    const result = validar("1e3");
    expect(result.ok).toBe(false);
  });

  it.each(["   ", "\t", "\n  \n"])("rejects whitespace-only input %j", (valor) => {
    const result = validar(valor);
    expect(result.ok).toBe(false);
  });

  it("accepts a value surrounded by whitespace (trimmed before parsing)", () => {
    const result = validar("  0.01  ");
    expect(result.ok).toBe(true);
  });
});

describe("parametros-registry: exceso_pesada_porcentaje", () => {
  const validar = PARAMETROS_REGISTRY.exceso_pesada_porcentaje.validar;

  it.each(["0", "50", "100"])("accepts %s", (valor) => {
    const result = validar(valor);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["-1", "below range"],
    ["101", "above range"],
    ["abc", "non-numeric"],
    ["", "empty"],
  ])("rejects %s (%s)", (valor) => {
    const result = validar(valor);
    expect(result.ok).toBe(false);
  });
});

describe("editarDatosTenant zod schema: the 4 non-editable tenant fields are never accepted", () => {
  const baseInput = { razonSocial: "Farmacia Test" };

  it("accepts the 4 editable fields", () => {
    const result = editarDatosTenantInput.safeParse({
      razonSocial: "Farmacia Test",
      nombreFantasia: "Fantasia",
      domicilio: "Calle Falsa 123",
      matriculaFarmacia: "MAT-1",
    });
    expect(result.success).toBe(true);
  });

  it.each(["cuit", "zonaHoraria", "fechaBaja", "fechaActivacionContralor"])(
    "rejects (safeParse fails) when the input carries the non-editable field %s",
    (fieldName) => {
      const result = editarDatosTenantInput.safeParse({ ...baseInput, [fieldName]: "anything" });
      expect(result.success).toBe(false);
    },
  );

  it("even a successful parse's output type/value never has those keys", () => {
    const result = editarDatosTenantInput.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual(["razonSocial"]);
      expect("cuit" in result.data).toBe(false);
      expect("zonaHoraria" in result.data).toBe(false);
      expect("fechaBaja" in result.data).toBe(false);
      expect("fechaActivacionContralor" in result.data).toBe(false);
    }
  });
});
