/**
 * Etiqueta content (modules/preparaciones/domain/etiqueta.ts): vía per
 * forma, Rp/ selection and formatting, receta-number fallback, the
 * persisted text -- plus a smoke test of the PDF layout.
 */
import { describe, it, expect } from "vitest";
import {
  armarContenidoEtiqueta,
  columnasRp,
  componentesRp,
  MAX_LINEAS_RP,
  formaSegunCantidad,
  formatearContenidoEtiqueta,
  formatearLineaRp,
  hrefEtiquetaPdf,
  formatearMedicoEtiqueta,
  formatearVenceEtiqueta,
  numeroRecetaEtiqueta,
  viaDeAdministracion,
  VENCE_ETIQUETA,
} from "@/modules/preparaciones/domain/etiqueta";
import type { ComponenteEtiqueta, DatosEtiqueta } from "@/modules/preparaciones/domain/etiqueta";
import { buildEtiquetaPdf, tamanoFuenteRp } from "@/modules/preparaciones/infrastructure/etiqueta-pdf";

function componente(overrides: Partial<ComponenteEtiqueta>): ComponenteEtiqueta {
  return { drogaNombre: "Droga", cantidad: "1", unidadSimbolo: "mg", modoExpresion: "POR_DOSIS", esPrincipioActivo: false, ...overrides };
}

const DATOS: DatosEtiqueta = {
  formaFarmaceutica: "CAPSULA",
  cantidadUnidades: 30,
  componentes: [
    componente({ drogaNombre: "Mazindol", cantidad: "2", esPrincipioActivo: true }),
    componente({ drogaNombre: "Lactosa", cantidad: null, modoExpresion: "CSP" }),
  ],
  asientoNumeroCorrelativo: "1520",
  recetaNumeroInterno: "88",
  pacienteTexto: "Pérez, Juan",
  medicoNombre: "Ana",
  medicoApellido: "Gómez",
  medicoMatricula: "4521",
  medicoJurisdiccion: "PROVINCIAL",
  directorTecnico: { nombre: "María", apellido: "López", matricula: "3310" },
  tenantDomicilio: "Av. San Martín 1234, Mendoza",
  fechaVencimiento: "2027-03-15",
};

describe("viaDeAdministracion", () => {
  it("derives the vía from the forma, agreeing in number", () => {
    expect(viaDeAdministracion("CAPSULA", 30)).toBe("Orales");
    expect(viaDeAdministracion("CAPSULA", 1)).toBe("Oral");
    expect(viaDeAdministracion("JARABE", 1)).toBe("Oral");
    expect(viaDeAdministracion("CREMA", 1)).toBe("Uso externo");
    expect(viaDeAdministracion("GEL", 2)).toBe("Uso externo");
    expect(viaDeAdministracion("OVULO", 10)).toBe("Vaginales");
    expect(viaDeAdministracion("SUPOSITORIO", 1)).toBe("Rectal");
  });

  it("is empty for the ambiguous formas", () => {
    expect(viaDeAdministracion("SOLUCION", 1)).toBeNull();
    expect(viaDeAdministracion("SUSPENSION", 1)).toBeNull();
  });

  it("the forma label agrees with the quantity", () => {
    expect(formaSegunCantidad("CAPSULA", 30)).toBe("Cápsulas");
    expect(formaSegunCantidad("CREMA", 1)).toBe("Crema");
    expect(formaSegunCantidad("LOCION", 2)).toBe("Lociones");
  });
});

describe("Rp/", () => {
  it("lists only the principios activos, sorted by name", () => {
    const rp = componentesRp([
      componente({ drogaNombre: "B", esPrincipioActivo: true }),
      componente({ drogaNombre: "Excipiente" }),
      componente({ drogaNombre: "A", esPrincipioActivo: true }),
    ]);
    expect(rp.map((c) => c.drogaNombre)).toEqual(["A", "B"]);
  });

  it("with no activo flagged, lists every componente except CS/CSP", () => {
    const rp = componentesRp([
      componente({ drogaNombre: "Ácido salicílico", modoExpresion: "TOTAL" }),
      componente({ drogaNombre: "Agua", modoExpresion: "CS", cantidad: null }),
      componente({ drogaNombre: "Vaselina", modoExpresion: "CSP", cantidad: null }),
    ]);
    expect(rp.map((c) => c.drogaNombre)).toEqual(["Ácido salicílico"]);
  });

  it("formats 'Droga cantidad unidad' with es-AR decimals", () => {
    expect(formatearLineaRp({ drogaNombre: "Mazindol", cantidad: "2.000", unidadSimbolo: "mg" })).toBe("Mazindol 2 mg");
    expect(formatearLineaRp({ drogaNombre: "Clonazepam", cantidad: "0.3", unidadSimbolo: "mg" })).toBe("Clonazepam 0,3 mg");
    expect(formatearLineaRp({ drogaNombre: "Vaselina", cantidad: null, unidadSimbolo: "g" })).toBe("Vaselina");
  });

  describe("columnasRp", () => {
    const lineas = (n: number) => Array.from({ length: n }, (_, i) => `Droga ${i + 1}`);

    it("up to 7 lines go in a single column", () => {
      expect(columnasRp(lineas(1))).toEqual([["Droga 1"]]);
      expect(columnasRp(lineas(7))).toEqual([lineas(7)]);
    });

    it("8 to 14 lines are split into two balanced columns, the first one taking the odd line", () => {
      expect(columnasRp(lineas(8)).map((c) => c.length)).toEqual([4, 4]);
      expect(columnasRp(lineas(9)).map((c) => c.length)).toEqual([5, 4]);
      expect(columnasRp(lineas(14))).toEqual([lineas(7), lineas(14).slice(7)]);
    });

    it(`beyond ${MAX_LINEAS_RP} lines, prints the first ${MAX_LINEAS_RP - 1} and says how many are left out`, () => {
      const columnas = columnasRp(lineas(17));
      expect(columnas.map((c) => c.length)).toEqual([7, 7]);
      expect(columnas.flat().slice(0, 13)).toEqual(lineas(13));
      expect(columnas[1]!.at(-1)).toBe("… y 4 más");
    });

    it("no lines, no columns", () => {
      expect(columnasRp([])).toEqual([]);
    });
  });

  it("the persisted text keeps every Rp/ line, even beyond what the label prints", () => {
    const muchos = Array.from({ length: 16 }, (_, i) => componente({ drogaNombre: `Activo ${i + 1}`, esPrincipioActivo: true }));
    const texto = formatearContenidoEtiqueta(armarContenidoEtiqueta({ ...DATOS, componentes: muchos }));
    for (let i = 1; i <= 16; i++) expect(texto).toContain(`Activo ${i} 1 mg`);
  });

  it("the font shrinks with the number of lines", () => {
    expect(tamanoFuenteRp(1)).toBeGreaterThan(tamanoFuenteRp(2));
    expect(tamanoFuenteRp(6)).toBeGreaterThan(tamanoFuenteRp(8));
    expect(tamanoFuenteRp(12)).toBeLessThan(tamanoFuenteRp(8));
  });
});

describe("numeroRecetaEtiqueta", () => {
  it("uses the libro recetario asiento number, else the receta's número interno", () => {
    expect(numeroRecetaEtiqueta({ asientoNumeroCorrelativo: "1520", recetaNumeroInterno: "88" })).toBe("1520");
    expect(numeroRecetaEtiqueta({ asientoNumeroCorrelativo: null, recetaNumeroInterno: "88" })).toBe("88");
  });
});

describe("armarContenidoEtiqueta / formatearContenidoEtiqueta", () => {
  it("builds the label content; the paciente is not shown", () => {
    const contenido = armarContenidoEtiqueta(DATOS);
    expect(contenido).toMatchObject({
      directorTecnico: { nombre: "MARÍA LÓPEZ", matricula: "3310" },
      rp: ["Mazindol 2 mg"],
      recetaNumero: "1520",
      cantidad: 30,
      forma: "Cápsulas",
      via: "Orales",
      medico: "Médico Gómez, Ana  MAT MP 4521",
      paciente: null,
    });
  });

  it("médico: MN for a national matrícula", () => {
    expect(formatearMedicoEtiqueta({ ...DATOS, medicoJurisdiccion: "NACIONAL" })).toBe("Médico Gómez, Ana  MAT MN 4521");
  });

  it("the persisted text mirrors the label (blank DT line when none was vigente)", () => {
    const texto = formatearContenidoEtiqueta(armarContenidoEtiqueta({ ...DATOS, directorTecnico: null }));
    expect(texto.split("\n")).toEqual([
      "Director Técnico ______",
      "Av. San Martín 1234, Mendoza",
      "Rp/",
      "Mazindol 2 mg",
      "Vence: 03/27",
      "Receta N 1520",
      "30 Cápsulas — Orales",
      "Conservar en lugar fresco y seco",
      "Médico Gómez, Ana  MAT MP 4521",
    ]);
    expect(texto).not.toContain("Pérez");
  });

  it("'Vence: MM/YY' from the snapshot fecha_vencimiento; a blank line when there is none", () => {
    expect(formatearVenceEtiqueta("2026-03-31")).toBe("Vence: 03/26");
    expect(formatearVenceEtiqueta("2029-02-28")).toBe("Vence: 02/29");
    expect(formatearVenceEtiqueta("2100-12-01")).toBe("Vence: 12/00");
    expect(formatearVenceEtiqueta(null)).toBe("Vence: ______");
    expect(VENCE_ETIQUETA).toBe("Vence: ______");
    expect(armarContenidoEtiqueta({ ...DATOS, fechaVencimiento: "2026-09-30" }).vence).toBe("Vence: 09/26");
    expect(armarContenidoEtiqueta({ ...DATOS, fechaVencimiento: null }).vence).toBe("Vence: ______");
  });
});

describe("buildEtiquetaPdf", () => {
  it("renders a one-page PDF", async () => {
    const pdf = await buildEtiquetaPdf(armarContenidoEtiqueta(DATOS));
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it("stays one page with many Rp/ lines, no vía, no DT and no domicilio", async () => {
    const muchos = Array.from({ length: 12 }, (_, i) => componente({ drogaNombre: `Droga con un nombre bastante largo ${i + 1}`, esPrincipioActivo: true }));
    const pdf = await buildEtiquetaPdf(armarContenidoEtiqueta({ ...DATOS, formaFarmaceutica: "SOLUCION", cantidadUnidades: 1, componentes: muchos, directorTecnico: null, tenantDomicilio: null }));
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it.each([7, 8, 14, 20])("stays one page with %i principios activos (one or two columns, overflow line)", async (n) => {
    const activos = Array.from({ length: n }, (_, i) => componente({ drogaNombre: `Principio activo ${i + 1}`, cantidad: "12.5", esPrincipioActivo: true }));
    const pdf = await buildEtiquetaPdf(armarContenidoEtiqueta({ ...DATOS, componentes: activos }));
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
});

/** The `/MediaBox [0 0 w h]` of the first page, in PDF points. */
function mediaBox(pdf: Buffer): { ancho: number; alto: number } {
  const match = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
  if (!match) throw new Error("no MediaBox found in the PDF");
  return { ancho: Number(match[1]), alto: Number(match[2]) };
}

const PT_POR_MM = 72 / 25.4;

describe("buildEtiquetaPdf -- page size", () => {
  it("defaults to the 100 x 42 mm the layout was designed for", async () => {
    const box = mediaBox(await buildEtiquetaPdf(armarContenidoEtiqueta(DATOS)));
    expect(box.ancho).toBeCloseTo(100 * PT_POR_MM, 1);
    expect(box.alto).toBeCloseTo(42 * PT_POR_MM, 1);
  });

  it("renders a one-page PDF on the chosen size (50 x 30 mm = 141.7 x 85 pt)", async () => {
    const pdf = await buildEtiquetaPdf(armarContenidoEtiqueta(DATOS), { anchoMm: 50, altoMm: 30 });
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
    const box = mediaBox(pdf);
    expect(box.ancho).toBeCloseTo(141.7, 1);
    expect(box.alto).toBeCloseTo(85, 1);
  });

  it("supports a size larger than the design and one with decimals", async () => {
    const grande = mediaBox(await buildEtiquetaPdf(armarContenidoEtiqueta(DATOS), { anchoMm: 200, altoMm: 84 }));
    expect(grande.ancho).toBeCloseTo(200 * PT_POR_MM, 1);
    const decimal = mediaBox(await buildEtiquetaPdf(armarContenidoEtiqueta(DATOS), { anchoMm: 62.5, altoMm: 29.7 }));
    expect(decimal.ancho).toBeCloseTo(62.5 * PT_POR_MM, 1);
    expect(decimal.alto).toBeCloseTo(29.7 * PT_POR_MM, 1);
  });
});

describe("hrefEtiquetaPdf", () => {
  it("points the PDF route at the preparación and the chosen size", () => {
    expect(hrefEtiquetaPdf("prep-1", "tam-2")).toBe("/api/preparaciones/prep-1/etiqueta/pdf?tamano=tam-2");
  });

  it("encodes both ids", () => {
    expect(hrefEtiquetaPdf("a/b", "c&d")).toBe("/api/preparaciones/a%2Fb/etiqueta/pdf?tamano=c%26d");
  });
});
