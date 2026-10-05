import { describe, it, expect } from "vitest";
import { FIELD_LABELS, fieldLabel, formatIssuePath } from "@/shared/labels/field-labels";
import { etiquetaCampo } from "@/modules/auditoria/domain/presentacion";

describe("shared/labels/field-labels#formatIssuePath", () => {
  it("returns null for an empty path (an issue about the input as a whole)", () => {
    expect(formatIssuePath([])).toBeNull();
  });

  it("maps a known key to its label", () => {
    expect(formatIssuePath(["numeroMatricula"])).toBe("Matrícula");
  });

  it("humanizes an unmapped camelCase key instead of failing", () => {
    expect(FIELD_LABELS).not.toHaveProperty("fechaDeAltaTentativa");
    expect(formatIssuePath(["fechaDeAltaTentativa"])).toBe("Fecha de alta tentativa");
  });

  it("joins nested segments and shows array indices 1-based", () => {
    expect(formatIssuePath(["items", 1, "componentes", 0, "drogaId"])).toBe("Ítems › n.º 2 › Componentes › n.º 1 › Droga");
  });

  it("does not resolve inherited Object.prototype keys as labels", () => {
    expect(formatIssuePath(["constructor"])).toBe("Constructor");
  });
});

describe("shared/labels/field-labels#fieldLabel", () => {
  it("drops a trailing Id in the fallback, so an unmapped reference names its entity", () => {
    expect(fieldLabel("laboratorioId")).toBe("Laboratorio");
  });

  it("is the same dictionary the audit diff table uses", () => {
    for (const campo of ["motivoAjuste", "numeroMatricula", "asientoOriginal", "campoNoMapeado"]) {
      expect(etiquetaCampo(campo)).toBe(fieldLabel(campo));
      expect(formatIssuePath([campo])).toBe(fieldLabel(campo));
    }
  });
});

describe("shared/labels/field-labels -- receta import inputs", () => {
  it("labels the QR text input and the import source (never shown as raw camelCase in an error)", () => {
    expect(formatIssuePath(["qr"])).toBe("QR o link de la receta");
    expect(formatIssuePath(["fuente"])).toBe("Fuente de la importación");
  });
});
