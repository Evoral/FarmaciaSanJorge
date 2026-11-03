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

  // openspec/specs/numeros-ingresados/spec.md (N6): exponential notation ("1e-3", "1e3") is refused by
  // `interpretarNumero` even when the numeric value (0.001) would otherwise be in the allowed set.
  it("rejects exponential notation '1e-3' (refused by N6 even though 0.001 is an allowed value)", () => {
    const result = validar("1e-3");
    expect(result.ok).toBe(false);
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

describe("parametros-registry: meses_vencimiento_preparado", () => {
  const def = PARAMETROS_REGISTRY.meses_vencimiento_preparado;

  it("is registered with the default 3", () => {
    expect(def.clave).toBe("meses_vencimiento_preparado");
    expect(def.valorPorDefecto).toBe("3");
    expect(def.validar(def.valorPorDefecto).ok).toBe(true);
  });

  it.each(["1", "3", "24", "60"])("accepts %s", (valor) => {
    expect(def.validar(valor).ok).toBe(true);
  });

  it.each([
    ["0", "below one"],
    ["61", "above the 60-month cap"],
    ["999999999", "absurdly large"],
    ["-1", "negative"],
    ["1.5", "not an integer"],
    ["abc", "non-numeric"],
    ["", "empty"],
  ])("rejects %s (%s)", (valor) => {
    expect(def.validar(valor).ok).toBe(false);
  });
});

describe("parametros-registry: dias_retiro_vencido", () => {
  const def = PARAMETROS_REGISTRY.dias_retiro_vencido;

  it("is registered with the default 30", () => {
    expect(def.clave).toBe("dias_retiro_vencido");
    expect(def.label).toBe("Días para el retiro");
    expect(def.valorPorDefecto).toBe("30");
    expect(def.validar(def.valorPorDefecto).ok).toBe(true);
  });

  it.each(["0", "1", "30", "365"])("accepts %s (0 disables the vencimiento)", (valor) => {
    expect(def.validar(valor).ok).toBe(true);
  });

  it.each([
    ["-1", "negative"],
    ["366", "above the 365-day cap"],
    ["999999999", "absurdly large"],
    ["1.5", "not an integer"],
    ["abc", "non-numeric"],
    ["", "empty"],
  ])("rejects %s (%s)", (valor) => {
    expect(def.validar(valor).ok).toBe(false);
  });
});

// openspec/changes/lector-qr-configurable (P77): an OPCION parametro accepts only a listed value, exact match.
describe("parametros-registry: lector_qr_receta", () => {
  const def = PARAMETROS_REGISTRY.lector_qr_receta;

  it("is an OPCION parametro with the default CAMARA", () => {
    expect(def.tipo).toBe("OPCION");
    expect(def.valorPorDefecto).toBe("CAMARA");
    expect(def.validar(def.valorPorDefecto)).toEqual({ ok: true, valor: "CAMARA" });
  });

  it.each(["CAMARA", "LECTOR"])("accepts %s", (valor) => {
    expect(def.validar(valor)).toEqual({ ok: true, valor });
  });

  it.each(["camara", "Lector", "AMBOS", "", "FARMACIA"])("rejects %j", (valor) => {
    expect(def.validar(valor)).toEqual({ ok: false, error: "Elegí una de las opciones." });
  });
});

describe("parametros-registry: numeric parametros store the normalized number", () => {
  it.each([
    ["precision_balanza", " 0,010 ", "0.01"],
    ["exceso_pesada_porcentaje", "5", "5"],
  ] as const)("%s: %j -> %s", (clave, valorRaw, esperado) => {
    expect(PARAMETROS_REGISTRY[clave].validar(valorRaw)).toEqual({ ok: true, valor: esperado });
  });
});

describe("editarDatosTenant zod schema: the 3 non-editable tenant fields are never accepted", () => {
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

  it("accepts the cuit (editable at any time, openspec/specs/cuit-farmacia/spec.md)", () => {
    expect(editarDatosTenantInput.safeParse({ ...baseInput, cuit: "30-12345678-9" }).success).toBe(true);
  });

  it.each(["zonaHoraria", "fechaBaja", "fechaActivacionContralor"])(
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
