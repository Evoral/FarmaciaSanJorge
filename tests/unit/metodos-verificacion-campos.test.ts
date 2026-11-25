/**
 * Verification methods (openspec/changes/metodos-verificacion-operador): the form field names and the request carrier
 * derive from the method catalog, so a new method needs no change in either.
 */
import { describe, it, expect } from "vitest";
import { campoDeOperador, camposDeOperador, esCampoDeOperador, CAMPOS_DE_PRUEBA_OPERADOR, CAMPO_OPERADOR_PIN } from "@/shared/auth/operador-campos";
import { conOperador, solicitudDeOperador } from "@/shared/auth/operador-context";
import { METODOS, METODOS_VERIFICACION, METODO_POR_DEFECTO } from "@/modules/auth/domain/verificacion-identidad";

describe("operador campos", () => {
  it("names a proof field as operador + the capitalized key", () => {
    expect(campoDeOperador("pin")).toBe("operadorPin");
    expect(campoDeOperador("huella")).toBe("operadorHuella");
  });

  it("keeps the PIN field name the pipeline and the forms rely on", () => {
    expect(CAMPO_OPERADOR_PIN).toBe("operadorPin");
    expect(camposDeOperador("PIN")).toEqual([CAMPO_OPERADOR_PIN]);
  });

  it("returns every operador field for an unknown method", () => {
    expect(camposDeOperador("OTRO")).toEqual(CAMPOS_DE_PRUEBA_OPERADOR);
  });

  it("recognizes every catalog field and nothing else", () => {
    for (const metodo of METODOS_VERIFICACION) {
      for (const clave of METODOS[metodo].claves) expect(esCampoDeOperador(campoDeOperador(clave))).toBe(true);
    }
    expect(esCampoDeOperador("operadorMetodo")).toBe(false);
    expect(esCampoDeOperador("pin")).toBe(false);
  });
});

describe("conOperador carrier", () => {
  async function credencialDe(campos: Record<string, string>) {
    const formData = new FormData();
    for (const [campo, valor] of Object.entries(campos)) formData.set(campo, valor);
    return conOperador(formData, async () => {
      const credencial = solicitudDeOperador()?.credencial ?? null;
      return { status: "success" as const, credencial };
    });
  }

  it("defaults to the PIN when the form names no method", async () => {
    expect(METODO_POR_DEFECTO).toBe("PIN");
    expect(await credencialDe({ operadorPin: "4829" })).toMatchObject({ credencial: { prueba: { metodo: "PIN", pin: "4829" } } });
  });

  it("uses the method the form names", async () => {
    expect(await credencialDe({ operadorMetodo: "PIN", operadorPin: "4829" })).toMatchObject({ credencial: { prueba: { metodo: "PIN", pin: "4829" } } });
  });

  it("carries no credential when no proof field was sent", async () => {
    expect(await credencialDe({ operadorMetodo: "PIN" })).toMatchObject({ credencial: null });
    expect(await credencialDe({ operadorPin: "" })).toMatchObject({ credencial: null });
  });
});
