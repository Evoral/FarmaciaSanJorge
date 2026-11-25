/**
 * Form plumbing for the acting empleado's proof: a retained FormData must never carry a proof field typed for another
 * method into the carrier (shared/auth/operador-campos.ts, operador-context.ts).
 */
import { describe, it, expect } from "vitest";
import { aplicarCamposDeOperador, CAMPO_OPERADOR_METODO, CAMPOS_DE_PRUEBA_OPERADOR } from "@/shared/auth/operador-campos";
import { conOperador, solicitudDeOperador } from "@/shared/auth/operador-context";

describe("aplicarCamposDeOperador", () => {
  it("sets the PIN proof on a plain form", () => {
    const formData = new FormData();
    formData.set("nombre", "x");
    aplicarCamposDeOperador(formData, { operadorPin: "4829" });
    expect(formData.get("operadorPin")).toBe("4829");
    expect(formData.get("nombre")).toBe("x");
    expect(formData.has(CAMPO_OPERADOR_METODO)).toBe(false);
  });

  it("drops every earlier proof field and the method before setting the chosen ones", () => {
    const formData = new FormData();
    formData.set(CAMPO_OPERADOR_METODO, "OTRO");
    for (const campo of CAMPOS_DE_PRUEBA_OPERADOR) formData.set(campo, "viejo");
    formData.set("otroCampo", "queda");
    aplicarCamposDeOperador(formData, { operadorPin: "1111" });
    expect(formData.has(CAMPO_OPERADOR_METODO)).toBe(false);
    expect(formData.get("operadorPin")).toBe("1111");
    expect(formData.get("otroCampo")).toBe("queda");
  });

  it("leaves no stale proof for the carrier to merge", async () => {
    const formData = new FormData();
    formData.set(CAMPO_OPERADOR_METODO, "OTRO");
    formData.set("operadorPin", "viejo");
    aplicarCamposDeOperador(formData, { operadorPin: "2222" });
    const credencial = await conOperador(formData, async () => {
      return { status: "success", credencial: solicitudDeOperador()?.credencial };
    });
    expect(credencial).toMatchObject({ credencial: { prueba: { metodo: "PIN", pin: "2222" } } });
  });
});
