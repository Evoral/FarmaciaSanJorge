import { describe, it, expect } from "vitest";
import {
  calcularCambios,
  describirRegistro,
  etiquetaCampo,
  etiquetaEntidad,
  formatearFechaHora,
  formatearValor,
} from "@/modules/auditoria/domain/presentacion";

const TZ = "America/Argentina/Mendoza";

describe("describirRegistro", () => {
  it("builds a plain sentence with the entidad's article", () => {
    expect(describirRegistro("María López", "MODIFICAR", "droga")).toBe("María López modificó la droga");
    expect(describirRegistro("María López", "CREAR", "lote_archivo_recetas")).toBe("María López creó el lote de archivo");
  });

  it("contracts 'de el' -> 'del' and 'a el' -> 'al'", () => {
    expect(describirRegistro("Juan Pérez", "CAMBIAR_ESTADO", "usuario")).toBe("Juan Pérez cambió el estado del usuario");
    expect(describirRegistro("Juan Pérez", "ASIGNAR_ROL", "usuario")).toBe("Juan Pérez asignó un rol al usuario");
  });

  it("does not contract feminine or plural articles", () => {
    expect(describirRegistro("Ana Gil", "CAMBIAR_ESTADO", "receta")).toBe("Ana Gil cambió el estado de la receta");
    expect(describirRegistro("Ana Gil", "MODIFICAR", "tenant")).toBe("Ana Gil modificó los datos de la farmacia");
  });

  it("falls back to the raw entidad code for rows written before an entidad had a label", () => {
    expect(describirRegistro("Ana Gil", "CREAR", "entidad_vieja")).toBe("Ana Gil creó entidad_vieja");
    expect(etiquetaEntidad("entidad_vieja")).toBe("entidad_vieja");
  });
});

describe("etiquetaCampo", () => {
  it("uses the Spanish label for known fields", () => {
    expect(etiquetaCampo("stockMinimo")).toBe("Stock mínimo");
    expect(etiquetaCampo("drogaId")).toBe("Droga");
  });

  it("humanizes unknown camelCase / snake_case keys instead of showing code", () => {
    expect(etiquetaCampo("fechaUltimoControl")).toBe("Fecha ultimo control");
    expect(etiquetaCampo("laboratorioId")).toBe("Laboratorio");
    expect(etiquetaCampo("campo_nuevo")).toBe("Campo nuevo");
  });
});

describe("formatearValor", () => {
  it("formats booleans, empty values, numbers and enum codes", () => {
    expect(formatearValor(true, TZ)).toBe("Sí");
    expect(formatearValor(false, TZ)).toBe("No");
    expect(formatearValor(null, TZ)).toBe("—");
    expect(formatearValor("", TZ)).toBe("—");
    expect(formatearValor(1500.5, TZ)).toBe("1.500,5");
    expect(formatearValor("PENDIENTE_PREPARACION", TZ)).toBe("Pendiente preparacion");
    expect(formatearValor("ACTIVO", TZ)).toBe("Activo");
  });

  it("keeps ordinary text untouched (short uppercase words are not mistaken for codes)", () => {
    expect(formatearValor("Ibuprofeno", TZ)).toBe("Ibuprofeno");
    expect(formatearValor("DNI", TZ)).toBe("DNI");
  });

  it("formats calendar dates as dd/mm/aaaa and instants in the pharmacy's time zone", () => {
    expect(formatearValor("2026-09-28", TZ)).toBe("28/09/2026");
    // 02:30 UTC on the 29th is still 23:30 on the 28th in Mendoza.
    expect(formatearValor("2026-09-29T02:30:00.000Z", TZ)).toBe(formatearFechaHora("2026-09-29T02:30:00.000Z", TZ));
    expect(formatearFechaHora("2026-09-29T02:30:00.000Z", TZ)).toContain("28/9/26");
  });

  it("shortens bare ids (the full id stays in the technical detail) and joins primitive arrays", () => {
    expect(formatearValor("3f2a9b1c-1111-4222-8333-944455556666", TZ)).toBe("ref. 3f2a9b1c");
    expect(formatearValor(["ADMINISTRADOR", "FARMACEUTICO"], TZ)).toBe("Administrador, Farmaceutico");
  });
});

describe("calcularCambios", () => {
  it("edit: returns ONLY the fields whose value changed", () => {
    const antes = { nombre: "Ibuprofeno", stockMinimo: "10", esControlada: false };
    const despues = { nombre: "Ibuprofeno", stockMinimo: "20", esControlada: true };
    expect(calcularCambios(antes, despues, TZ)).toEqual([
      { campo: "stockMinimo", etiqueta: "Stock mínimo", antes: "10", despues: "20" },
      { campo: "esControlada", etiqueta: "Controlada", antes: "No", despues: "Sí" },
    ]);
  });

  it("edit with no real difference: returns nothing", () => {
    expect(calcularCambios({ a: 1 }, { a: 1 }, TZ)).toEqual([]);
  });

  it("creation (only valorNuevo): lists every field with no 'antes'", () => {
    expect(calcularCambios(null, { lote: "L-01", cantidad: 5 }, TZ)).toEqual([
      { campo: "lote", etiqueta: "Lote", antes: null, despues: "L-01" },
      { campo: "cantidad", etiqueta: "Cantidad", antes: null, despues: "5" },
    ]);
  });

  it("removal (only valorAnterior): lists every field with no 'después'", () => {
    expect(calcularCambios({ rol: "FARMACEUTICO" }, undefined, TZ)).toEqual([{ campo: "rol", etiqueta: "Rol", antes: "Farmaceutico", despues: null }]);
  });

  it("a field present on only one side of an edit is still reported", () => {
    expect(calcularCambios({ estado: "ACTIVO" }, { estado: "BAJA", motivoBaja: "Renuncia" }, TZ)).toEqual([
      { campo: "estado", etiqueta: "Estado", antes: "Activo", despues: "Baja" },
      { campo: "motivoBaja", etiqueta: "Motivo de baja", antes: "—", despues: "Renuncia" },
    ]);
  });

  it("non-object values become a single 'Valor' row; no values at all -> empty", () => {
    expect(calcularCambios("A", "B", TZ)).toEqual([{ campo: "valor", etiqueta: "Valor", antes: "A", despues: "B" }]);
    expect(calcularCambios(null, null, TZ)).toEqual([]);
  });

  it("hides a raw reference when its readable sibling was stored next to it (xId -> x, items -> itemsResumen)", () => {
    const id = "3f2a9b1c-1111-4222-8333-944455556666";
    expect(calcularCambios(null, { drogaId: id, droga: "Ibuprofeno", lote: "L-01" }, TZ)).toEqual([
      { campo: "droga", etiqueta: "Droga", antes: null, despues: "Ibuprofeno" },
      { campo: "lote", etiqueta: "Lote", antes: null, despues: "L-01" },
    ]);
    expect(calcularCambios(null, { items: [{ drogaId: id }], itemsResumen: ["Crema ×1: Urea 10 g"] }, TZ)).toEqual([
      { campo: "itemsResumen", etiqueta: "Ítems", antes: null, despues: "Crema ×1: Urea 10 g" },
    ]);
  });

  it("an edit that changes a reference reports it once, by name", () => {
    const antes = { unidadBaseId: "3f2a9b1c-1111-4222-8333-944455556666", unidadBase: "gramo (g)" };
    const despues = { unidadBaseId: "9c1e0000-1111-4222-8333-944455556666", unidadBase: "miligramo (mg)" };
    expect(calcularCambios(antes, despues, TZ)).toEqual([{ campo: "unidadBase", etiqueta: "Unidad base", antes: "gramo (g)", despues: "miligramo (mg)" }]);
  });

  it("rows written before names were stored still show the short reference", () => {
    expect(calcularCambios(null, { drogaId: "3f2a9b1c-1111-4222-8333-944455556666" }, TZ)).toEqual([
      { campo: "drogaId", etiqueta: "Droga", antes: null, despues: "ref. 3f2a9b1c" },
    ]);
  });
});
