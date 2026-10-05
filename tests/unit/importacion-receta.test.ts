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
  acotarAvisos,
  advertenciasDeDiferencias,
  calcularCompletado,
  diferenciaDeNombre,
  mensajeRecetaYaImportada,
  resolverDroga,
  resolverUnidad,
  separarPorSeveridad,
  valoresACompletar,
} from "@/modules/recetas/domain/importacion-receta";
import type { AdvertenciaImportacion, CodigoAdvertenciaImportacion } from "@/modules/recetas/domain/importacion-receta";

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

describe("acotarAvisos (the bound on the notices of the final QR preview)", () => {
  const largos = (n: number) => "x".repeat(n);
  const aviso = (codigo: CodigoAdvertenciaImportacion, mensaje: string, texto?: string): AdvertenciaImportacion => (texto === undefined ? { codigo, mensaje } : { codigo, mensaje, texto });
  const puntos = (s: string) => Array.from(s).length;
  const sinSurrogadoSuelto = (s: string) => Array.from(s).every((c) => c.length === 2 || c.charCodeAt(0) < 0xd800 || c.charCodeAt(0) > 0xdfff);
  const OMITIDOS = { codigo: "AVISOS_OMITIDOS", mensaje: "Hay más avisos que no se muestran." };

  it("AVISOS_OMITIDOS is a regular warning in the severity map", () => {
    expect(SEVERIDAD_ADVERTENCIA.AVISOS_OMITIDOS).toBe("advertencia");
  });

  it("truncates mensaje and texto to 200 characters plus an ellipsis; exactly 200 is untouched", () => {
    const [largo, justo] = acotarAvisos([aviso("DROGA_SIN_MATCH", largos(250), largos(300)), aviso("DROGA_SIN_MATCH", largos(200), largos(200))]);
    expect(largo).toEqual({ codigo: "DROGA_SIN_MATCH", mensaje: `${largos(200)}…`, texto: `${largos(200)}…` });
    expect(justo).toEqual({ codigo: "DROGA_SIN_MATCH", mensaje: largos(200), texto: largos(200) });
  });

  it("a notice without texto stays without a texto key", () => {
    const [a] = acotarAvisos([aviso("PACIENTE_DADO_DE_BAJA", largos(260))]);
    expect(Object.keys(a!)).toEqual(["codigo", "mensaje"]);
  });

  it("never splits a surrogate pair at the cut", () => {
    // 199 BMP characters + 2 emoji = 201 code points, and the cut falls right between the emoji's UTF-16 halves.
    const texto = `${largos(199)}😀😀`;
    const [a] = acotarAvisos([aviso("UNIDAD_SIN_MATCH", texto, texto)]);
    expect(a!.mensaje).toBe(`${largos(199)}😀…`);
    expect(a!.texto).toBe(`${largos(199)}😀…`);
    expect(sinSurrogadoSuelto(a!.mensaje)).toBe(true);
    // Length is counted in code points, not UTF-16 units: 150 emoji are well under the cap.
    const emojis = "😀".repeat(150);
    expect(acotarAvisos([aviso("UNIDAD_SIN_MATCH", emojis)])[0]!.mensaje).toBe(emojis);
  });

  it("is idempotent: text already cut by an earlier layer does not get a second ellipsis", () => {
    const una = acotarAvisos([aviso("DROGA_SIN_MATCH", largos(250), largos(250))]);
    const dos = acotarAvisos(una);
    expect(dos).toEqual(una);
    expect(dos[0]!.mensaje.endsWith("……")).toBe(false);
    expect(puntos(dos[0]!.mensaje)).toBe(201);
  });

  it("up to 50 notices come back whole, in order, as new objects", () => {
    const lista = Array.from({ length: 50 }, (_, i) => aviso(i % 2 === 0 ? "DROGA_SIN_MATCH" : "RENGLON_INFORMATIVO", `aviso ${i}`));
    const r = acotarAvisos(lista);
    expect(r).toEqual(lista);
    expect(r).not.toBe(lista);
    r.forEach((a, i) => expect(a).not.toBe(lista[i]));
  });

  it("past 50 it keeps 49 plus the AVISOS_OMITIDOS notice, ALL warnings before any informational one", () => {
    const informativas = Array.from({ length: 30 }, (_, i) => aviso("RENGLON_INFORMATIVO", `info ${i}`));
    const advertencias = Array.from({ length: 60 }, (_, i) => aviso("DROGA_SIN_MATCH", `adv ${i}`));
    const r = acotarAvisos([...informativas, ...advertencias]);
    expect(r).toHaveLength(50);
    expect(r[49]).toEqual(OMITIDOS);
    expect(r.slice(0, 49).map((a) => a.mensaje)).toEqual(advertencias.slice(0, 49).map((a) => a.mensaje));
    expect(r.some((a) => a.codigo === "RENGLON_INFORMATIVO")).toBe(false);
  });

  it("when the warnings fit, informational notices fill the rest, each group in its original order", () => {
    const lista = [
      ...Array.from({ length: 40 }, (_, i) => aviso("RENGLON_INFORMATIVO", `info ${i}`)),
      ...Array.from({ length: 20 }, (_, i) => aviso("DIFERENCIA_DATOS", `adv ${i}`)),
    ];
    const r = acotarAvisos(lista);
    expect(r).toHaveLength(50);
    expect(r[49]).toEqual(OMITIDOS);
    expect(r.filter((a) => a.codigo === "DIFERENCIA_DATOS").map((a) => a.mensaje)).toEqual(Array.from({ length: 20 }, (_, i) => `adv ${i}`));
    expect(r.filter((a) => a.codigo === "RENGLON_INFORMATIVO").map((a) => a.mensaje)).toEqual(Array.from({ length: 29 }, (_, i) => `info ${i}`));
  });

  it("51 notices already overflow (49 kept + the overflow notice)", () => {
    const r = acotarAvisos(Array.from({ length: 51 }, (_, i) => aviso("DATO_FALTANTE", `a ${i}`)));
    expect(r).toHaveLength(50);
    expect(r[48]!.mensaje).toBe("a 48");
    expect(r[49]).toEqual(OMITIDOS);
  });

  it("truncates the kept notices too, and an empty list stays empty", () => {
    const r = acotarAvisos(Array.from({ length: 60 }, () => aviso("DROGA_SIN_MATCH", largos(500), largos(500))));
    expect(r.every((a) => puntos(a.mensaje) <= 201 && puntos(a.texto ?? "") <= 201)).toBe(true);
    expect(acotarAvisos([])).toEqual([]);
  });

  it("does not mutate the input, and the overflow notice is a fresh object every time", () => {
    const lista = Object.freeze(Array.from({ length: 60 }, (_, i) => Object.freeze(aviso("DROGA_SIN_MATCH", largos(300), `t${i}`))));
    const copia = JSON.stringify(lista);
    const a = acotarAvisos(lista);
    const b = acotarAvisos(lista);
    expect(JSON.stringify(lista)).toBe(copia);
    expect(a[49]).not.toBe(b[49]);
    (a[49] as { mensaje: string }).mensaje = "alterado";
    expect(acotarAvisos(lista)[49]).toEqual(OMITIDOS);
  });
});
