/**
 * Etiqueta content (modules/preparaciones/domain/etiqueta.ts): vía per
 * forma, Rp/ selection and formatting, receta-number fallback, the
 * persisted text -- plus a smoke test of the PDF layout and where it lands on the sheet
 * (docs/specs/hoja-etiquetas.md R4, R6).
 */
import { inflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import { HOJA_PREDETERMINADA, posicionCelda } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { ETIQUETA_TAMANO_PREDETERMINADO } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import {
  armarContenidoEtiqueta,
  columnasRp,
  componentesRp,
  dosisEtiqueta,
  MAX_LINEAS_RP,
  formaSegunCantidad,
  formatearContenidoEtiqueta,
  formatearLineaRp,
  hrefEtiquetaPdf,
  formatearMedicoEtiqueta,
  formatearVenceEtiqueta,
  numeroRecetaEtiqueta,
  parsearContenidoEtiqueta,
  viaDeAdministracion,
  VENCE_ETIQUETA,
} from "@/modules/preparaciones/domain/etiqueta";
import type { ComponenteEtiqueta, DatosEtiqueta } from "@/modules/preparaciones/domain/etiqueta";
import { buildEtiquetaPdf, colocarEtiqueta, tamanoFuenteRp } from "@/modules/preparaciones/infrastructure/etiqueta-pdf";

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
  tenantTelefonoFijo: "(0263) 4428850",
  tenantTelefonoCelular: "(0263) 154949843",
  posologia: "Media dosis cada 12 horas",
  fraccionDosisPorUnidad: "0.5",
  fechaVencimiento: "2027-03-15",
  tipoVencimiento: "ESTANDAR",
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
  it("builds the label content, paciente, phones, dosis and fracción included", () => {
    const contenido = armarContenidoEtiqueta(DATOS);
    expect(contenido).toMatchObject({
      directorTecnico: { nombre: "MARÍA LÓPEZ", matricula: "3310" },
      rp: ["Mazindol 2 mg"],
      recetaNumero: "1520",
      cantidad: 30,
      forma: "Cápsulas",
      via: "Orales",
      fraccionDosis: "1/2 Dosis",
      dosis: "2 cáp/día",
      telefonoFijo: "(0263) 4428850",
      celular: "(0263) 154949843",
      medico: "Médico: Ana Gómez  -  MAT:4521",
      paciente: "Pérez, Juan",
    });
  });

  it("médico: as on the farmacia's label", () => {
    expect(formatearMedicoEtiqueta(DATOS)).toBe("Médico: Ana Gómez  -  MAT:4521");
  });

  it("dosis: units per day from the posología; the text as written when it states no frequency", () => {
    expect(dosisEtiqueta("COMPRIMIDO", "Cada 8 horas", "1")).toBe("3 comp/día");
    expect(dosisEtiqueta("CAPSULA", "Cada 12 h", "0.5")).toBe("4 cáp/día");
    expect(dosisEtiqueta("CAPSULA", "Una vez al día", "1")).toBe("1 cáp/día");
    expect(dosisEtiqueta("CREMA", "Aplicar cada 12 horas", "1")).toBe("Aplicar cada 12 horas");
    expect(dosisEtiqueta("CAPSULA", "Según indicación", "1")).toBe("Según indicación");
    expect(dosisEtiqueta("CAPSULA", "  ", "1")).toBeNull();
  });

  it("a whole dose, or a form not counted in units, prints no fracción", () => {
    expect(armarContenidoEtiqueta({ ...DATOS, fraccionDosisPorUnidad: "1" }).fraccionDosis).toBeNull();
    expect(armarContenidoEtiqueta({ ...DATOS, formaFarmaceutica: "CREMA", fraccionDosisPorUnidad: "0.5" }).fraccionDosis).toBeNull();
  });

  it("round-trips every optional field, and a text stored before the phones still parses", () => {
    const contenido = armarContenidoEtiqueta({ ...DATOS, tenantDomicilio: null });
    expect(parsearContenidoEtiqueta(formatearContenidoEtiqueta(contenido))).toEqual(contenido);
    const sinNuevos = armarContenidoEtiqueta({ ...DATOS, tenantTelefonoFijo: null, tenantTelefonoCelular: null, posologia: null, fraccionDosisPorUnidad: "1" });
    expect(parsearContenidoEtiqueta(formatearContenidoEtiqueta(sinNuevos))).toEqual(sinNuevos);
  });

  it("the persisted text mirrors the label (blank DT line when none was vigente)", () => {
    const texto = formatearContenidoEtiqueta(armarContenidoEtiqueta({ ...DATOS, directorTecnico: null }));
    expect(texto.split("\n")).toEqual([
      "Director Técnico ______",
      "Av. San Martín 1234, Mendoza",
      "Teléfono fijo (0263) 4428850",
      "Celular (0263) 154949843",
      "Rp/",
      "Mazindol 2 mg",
      "Vence: 03/27",
      "Receta N 1520",
      "Dosis: 2 cáp/día",
      "30 Cápsulas — Orales",
      "Por unidad: 1/2 Dosis",
      "Conservar en lugar fresco y seco",
      "Paciente Pérez, Juan",
      "Médico: Ana Gómez  -  MAT:4521",
    ]);
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

const PT_POR_MM = 72 / 25.4;
const A4 = HOJA_PREDETERMINADA;
const ESTANDAR = ETIQUETA_TAMANO_PREDETERMINADO;

/** Renders the sample etiqueta on a sheet (A4 by default). */
function pdfEnHoja(tamano = ESTANDAR, celda?: { columna: number; fila: number }, hoja = A4) {
  return buildEtiquetaPdf(armarContenidoEtiqueta(DATOS), tamano, hoja, celda);
}

describe("buildEtiquetaPdf", () => {
  it("renders a one-page PDF", async () => {
    const pdf = await pdfEnHoja();
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it("stays one page with many Rp/ lines, no vía, no DT and no domicilio", async () => {
    const muchos = Array.from({ length: 12 }, (_, i) => componente({ drogaNombre: `Droga con un nombre bastante largo ${i + 1}`, esPrincipioActivo: true }));
    const pdf = await buildEtiquetaPdf(armarContenidoEtiqueta({ ...DATOS, formaFarmaceutica: "SOLUCION", cantidadUnidades: 1, componentes: muchos, directorTecnico: null, tenantDomicilio: null }), ESTANDAR, A4);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it.each([7, 8, 14, 20])("stays one page with %i principios activos (one or two columns, overflow line)", async (n) => {
    const activos = Array.from({ length: n }, (_, i) => componente({ drogaNombre: `Principio activo ${i + 1}`, cantidad: "12.5", esPrincipioActivo: true }));
    const pdf = await buildEtiquetaPdf(armarContenidoEtiqueta({ ...DATOS, componentes: activos }), ESTANDAR, A4);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
});

/** The `/MediaBox [0 0 w h]` of the first page, in PDF points. */
function mediaBox(pdf: Buffer): { ancho: number; alto: number } {
  const match = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
  if (!match) throw new Error("no MediaBox found in the PDF");
  return { ancho: Number(match[1]), alto: Number(match[2]) };
}

/** Inflates every Flate content stream of the PDF (pdfkit compresses them) into one text. */
function contenido(pdf: Buffer): string {
  const textos: string[] = [];
  for (const m of pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      textos.push(inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1"));
    } catch {
      // Not a Flate stream (an embedded image / font): not the page content.
    }
  }
  return textos.join("\n");
}

/** Where the page content moves its origin to draw the design: its first `q` + `1 0 0 1 x y cm`, then the uniform scale (pdfkit omits it when it is 1). */
function colocacionEnElPdf(pdf: Buffer): { x: number; y: number; escala: number } {
  const match = /\nq\n1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\n(?:([\d.]+) 0 0 [\d.]+ 0 0 cm\n)?/.exec(contenido(pdf));
  if (!match) throw new Error("no translate found in the page content");
  return { x: Number(match[1]), y: Number(match[2]), escala: match[3] === undefined ? 1 : Number(match[3]) };
}

describe("buildEtiquetaPdf -- the page is the sheet (R6)", () => {
  it("is the A4 sheet (210 x 297 mm), not the label size", async () => {
    const box = mediaBox(await pdfEnHoja());
    expect(box.ancho).toBeCloseTo(210 * PT_POR_MM, 1);
    expect(box.alto).toBeCloseTo(297 * PT_POR_MM, 1);
  });

  it("follows the sheet: landscape and decimals, whatever the label size", async () => {
    const horizontal = mediaBox(await pdfEnHoja({ anchoMm: 50, altoMm: 30 }, undefined, { anchoMm: 297, altoMm: 210, margenMm: 5 }));
    expect(horizontal.ancho).toBeCloseTo(297 * PT_POR_MM, 1);
    expect(horizontal.alto).toBeCloseTo(210 * PT_POR_MM, 1);
    const decimal = mediaBox(await pdfEnHoja(ESTANDAR, undefined, { anchoMm: 215.9, altoMm: 279.4, margenMm: 4.5 }));
    expect(decimal.ancho).toBeCloseTo(215.9 * PT_POR_MM, 1);
    expect(decimal.alto).toBeCloseTo(279.4 * PT_POR_MM, 1);
  });

  it("stays one page on the sheet for any cell and size", async () => {
    const pdf = await pdfEnHoja({ anchoMm: 50, altoMm: 30 }, { columna: 4, fila: 9 });
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
});

describe("colocarEtiqueta / buildEtiquetaPdf -- the etiqueta lands in the chosen cell (R4, R6)", () => {
  it("the 100 x 42 mm size is the design itself: scale 1 at the cell's corner", () => {
    const colocacion = colocarEtiqueta(ESTANDAR, A4, { columna: 1, fila: 1 });
    expect(colocacion.escala).toBeCloseTo(1, 9);
    expect(colocacion.x).toBeCloseTo(5 * PT_POR_MM, 6);
    expect(colocacion.y).toBeCloseTo(5 * PT_POR_MM, 6);
  });

  it("each cell moves the design by exactly one label size in mm", () => {
    const origen = colocarEtiqueta(ESTANDAR, A4, { columna: 1, fila: 1 });
    const otra = colocarEtiqueta(ESTANDAR, A4, { columna: 2, fila: 4 });
    expect(otra.x - origen.x).toBeCloseTo(100 * PT_POR_MM, 6);
    expect(otra.y - origen.y).toBeCloseTo(3 * 42 * PT_POR_MM, 6);
  });

  it("a smaller size is scaled uniformly and centered inside its cell", () => {
    const tamano = { anchoMm: 50, altoMm: 30 };
    const colocacion = colocarEtiqueta(tamano, A4, { columna: 3, fila: 2 });
    const esquina = posicionCelda(A4, tamano, { columna: 3, fila: 2 });
    const escala = Math.min(50 / 100, 30 / 42);
    expect(colocacion.escala).toBeCloseTo(escala, 9);
    // 50 x 30 is limited by its width (50 / 100): the design is centered vertically in the cell.
    expect(colocacion.x).toBeCloseTo(esquina.xMm * PT_POR_MM, 6);
    expect(colocacion.y).toBeCloseTo(esquina.yMm * PT_POR_MM + (30 * PT_POR_MM - 42 * PT_POR_MM * escala) / 2, 6);
  });

  it.each([
    [{ columna: 1, fila: 1 }, ESTANDAR],
    [{ columna: 2, fila: 6 }, ESTANDAR],
    [{ columna: 3, fila: 2 }, { anchoMm: 50, altoMm: 30 }],
  ])("the rendered page content is translated to the cell %j of %j", async (celda, tamano) => {
    const esperada = colocarEtiqueta(tamano, A4, celda);
    const real = colocacionEnElPdf(await pdfEnHoja(tamano, celda));
    expect(real.x).toBeCloseTo(esperada.x, 4);
    expect(real.y).toBeCloseTo(esperada.y, 4);
    expect(real.escala).toBeCloseTo(esperada.escala, 4);
  });

  it("defaults to column 1, row 1", async () => {
    const real = colocacionEnElPdf(await pdfEnHoja());
    expect(real.x).toBeCloseTo(5 * PT_POR_MM, 4);
    expect(real.y).toBeCloseTo(5 * PT_POR_MM, 4);
  });
});

describe("hrefEtiquetaPdf", () => {
  it("points the PDF route at the preparación, the chosen size and the cell", () => {
    expect(hrefEtiquetaPdf("prep-1", "tam-2", { columna: 3, fila: 2 })).toBe("/api/preparaciones/prep-1/etiqueta/pdf?tamano=tam-2&columna=3&fila=2");
  });

  it("encodes both ids", () => {
    expect(hrefEtiquetaPdf("a/b", "c&d", { columna: 1, fila: 1 })).toBe("/api/preparaciones/a%2Fb/etiqueta/pdf?tamano=c%26d&columna=1&fila=1");
  });
});
