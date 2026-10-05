/**
 * Pure match/fill rules of the receta PDF import
 * (modules/recetas/domain/importacion-receta.ts): P7 (droga match by alias
 * / normalized name, no fuzzy) and P9 (existing paciente: empty fields are
 * completed, existing values are never overwritten, differences warn).
 */
import { describe, it, expect } from "vitest";
import {
  CAMPOS_MEDICO_IMPORTABLES,
  CAMPOS_PACIENTE_IMPORTABLES,
  MENSAJE_CAMBIOS_DESDE_LECTURA,
  SEVERIDAD_ADVERTENCIA,
  advertenciasDeDiferencias,
  calcularCompletado,
  diferenciaDeNombre,
  mensajeRecetaYaImportada,
  resolverDroga,
  resolverUnidad,
  separarPorSeveridad,
  valoresACompletar,
} from "@/modules/recetas/domain/importacion-receta";
import type { CodigoAdvertenciaImportacion } from "@/modules/recetas/domain/importacion-receta";

const CAFEINA = { id: "d-cafeina", nombre: "Cafeína" };
const CLORURO = { id: "d-cloruro", nombre: "Cloruro de potasio" };
const PICOLINATO = { id: "d-picolinato", nombre: "Picolinato de cromo" };

describe("P7: resolverDroga", () => {
  it("a remembered alias matches first, even when a droga has that exact name", () => {
    const aliases = [{ aliasNormalizado: "cafeina", drogaId: "d-cafeina-anhidra" }];
    expect(resolverDroga("Cafeína", aliases, [CAFEINA])).toEqual({ drogaId: "d-cafeina-anhidra", via: "ALIAS" });
  });

  it("without an alias, a different accent/case/spacing still matches by normalized nombre", () => {
    expect(resolverDroga("CAFEINA", [], [CAFEINA, CLORURO])).toEqual({ drogaId: "d-cafeina", via: "NOMBRE" });
    expect(resolverDroga("  Picolinato  de   cromo ", [], [PICOLINATO])).toEqual({ drogaId: "d-picolinato", via: "NOMBRE" });
  });

  it("a misspelling does not match (exact comparison, no fuzzy)", () => {
    expect(resolverDroga("Cafeinna", [], [CAFEINA])).toBeNull();
    expect(resolverDroga("Cloruro potasio", [], [CLORURO])).toBeNull();
  });

  it("blank text never matches", () => {
    expect(resolverDroga("   ", [{ aliasNormalizado: "", drogaId: "x" }], [CAFEINA])).toBeNull();
  });
});

describe("resolverUnidad", () => {
  const unidades = [
    { id: "u-mg", codigo: "MILIGRAMO", simbolo: "mg" },
    { id: "u-g", codigo: "GRAMO", simbolo: "g" },
    { id: "u-ui", codigo: "UNIDAD_INTERNACIONAL", simbolo: "UI" },
  ];

  it("matches by normalized símbolo, then by código", () => {
    expect(resolverUnidad("mg", unidades)?.id).toBe("u-mg");
    expect(resolverUnidad("MG", unidades)?.id).toBe("u-mg");
    expect(resolverUnidad("ui", unidades)?.id).toBe("u-ui");
    expect(resolverUnidad("gramo", unidades)?.id).toBe("u-g");
  });

  it("an unknown unit is not guessed", () => {
    expect(resolverUnidad("mcg", unidades)).toBeNull();
  });
});

describe("P9: calcularCompletado (existing paciente/médico)", () => {
  it("fills an empty fecha de nacimiento, keeps a different teléfono and only warns about it", () => {
    const paciente = calcularCompletado(
      CAMPOS_PACIENTE_IMPORTABLES,
      { dni: "28999111", cuil: "27289991114", sexo: "Femenino", fechaNacimiento: null, nroCredencial: "" },
      { dni: "28999111", cuil: "27289991114", sexo: "FEMENINO", fechaNacimiento: "1981-03-05", nroCredencial: "27289991114" },
    );
    expect(paciente.completar).toEqual(["fechaNacimiento", "nroCredencial"]);
    expect(paciente.diferencias).toEqual([]); // "Femenino" vs "FEMENINO" is the same once normalized

    const medico = calcularCompletado(
      CAMPOS_MEDICO_IMPORTABLES,
      { especialidad: null, telefono: "261 4440000", direccionRegistrada: "San Martín 456" },
      { especialidad: "MEDICINA GENERAL", telefono: "261 5550000", direccionRegistrada: null },
    );
    expect(medico.completar).toEqual(["especialidad"]);
    expect(medico.diferencias).toEqual([{ campo: "telefono", actual: "261 4440000", pdf: "261 5550000" }]);
  });

  it("valoresACompletar only carries the fields to complete, trimmed", () => {
    const pdf = { dni: "1", fechaNacimiento: " 1981-03-05 " };
    expect(valoresACompletar<"dni" | "fechaNacimiento">(["fechaNacimiento"], pdf)).toEqual({ fechaNacimiento: "1981-03-05" });
  });

  it("the name is compared as a whole, normalized", () => {
    expect(diferenciaDeNombre({ nombre: "Ana", apellido: "Suárez" }, "ANA SUAREZ")).toBeNull();
    expect(diferenciaDeNombre({ nombre: "María José", apellido: "Fernández" }, "María José Fernández")).toBeNull();
    expect(diferenciaDeNombre({ nombre: "Ana", apellido: "Suárez" }, "Ana Pérez")).toEqual({ campo: "nombre", actual: "Ana Suárez", pdf: "Ana Pérez" });
  });

  it("each difference becomes an informative warning that keeps the system's value", () => {
    const [a] = advertenciasDeDiferencias("médico", [{ campo: "telefono", actual: "261 4440000", pdf: "261 5550000" }]);
    expect(a).toEqual({
      codigo: "DIFERENCIA_DATOS",
      mensaje: "Teléfono del médico: la receta dice «261 5550000», el sistema tiene «261 4440000». Se conserva el del sistema.",
    });
  });
});

describe("P6: duplicate message", () => {
  it("names the existing receta's número interno", () => {
    expect(mensajeRecetaYaImportada("123")).toBe("Esta receta ya fue cargada (receta interna Nº 123).");
  });
});

describe("SEVERIDAD_ADVERTENCIA (what the preview shows as a warning vs. as plain information)", () => {
  const TODOS = Object.keys(SEVERIDAD_ADVERTENCIA) as CodigoAdvertenciaImportacion[];

  it("classifies every notice code, and only RENGLON_INFORMATIVO is informational", () => {
    // Exhaustiveness is enforced by the Record type; this guards that the map is not empty and every value is a known severity.
    expect(TODOS).toContain("RENGLON_INFORMATIVO");
    expect(TODOS.every((c) => SEVERIDAD_ADVERTENCIA[c] === "advertencia" || SEVERIDAD_ADVERTENCIA[c] === "informativa")).toBe(true);
    expect(TODOS.filter((c) => SEVERIDAD_ADVERTENCIA[c] === "informativa")).toEqual(["RENGLON_INFORMATIVO"]);
    expect(SEVERIDAD_ADVERTENCIA.DATO_NO_IMPORTADO).toBe("advertencia");
  });

  it("separarPorSeveridad splits the list keeping each group's order", () => {
    const lista = [
      { codigo: "DATO_FALTANTE", mensaje: "a" },
      { codigo: "RENGLON_INFORMATIVO", mensaje: "b" },
      { codigo: "DROGA_SIN_MATCH", mensaje: "c" },
      { codigo: "RENGLON_INFORMATIVO", mensaje: "d" },
    ] as const;
    const { advertencias, informativas } = separarPorSeveridad(lista);
    expect(advertencias.map((a) => a.mensaje)).toEqual(["a", "c"]);
    expect(informativas.map((a) => a.mensaje)).toEqual(["b", "d"]);
    expect(separarPorSeveridad([])).toEqual({ advertencias: [], informativas: [] });
  });
});

describe("MENSAJE_CAMBIOS_DESDE_LECTURA", () => {
  it("does not name the source (the same message serves the PDF and the QR import)", () => {
    expect(MENSAJE_CAMBIOS_DESDE_LECTURA).toBe("Los datos cambiaron desde que se leyó la receta. Volvé a leerla.");
  });
});
