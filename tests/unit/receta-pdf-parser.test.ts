/**
 * Unit tests for modules/recetas/domain/receta-pdf-parser.ts and
 * modules/recetas/domain/normalizar.ts (docs/specs/importacion-receta-pdf.md,
 * cases P1-P5 and the normalization half of P7).
 *
 * Fixtures are hand-built text items laid out like a real RCTA receta
 * (A4 landscape, top-left origin, y growing downward -- the parser's
 * convention) with FICTITIOUS personal data only. No PDF is read here.
 */
import { describe, it, expect } from "vitest";
import {
  agruparRenglones,
  clasificarRenglonCuerpo,
  colapsar,
  controlarUnidadesVsDuracion,
  esUrlVerificacionDeEmisor,
  parsearCuerpo,
  parsearDecimalEsAr,
  parsearFechaDdMmAaaa,
  parsearRecetaPdf,
  separarContactoMedico,
  separarNombre,
  urlVerificacionRcta,
} from "@/modules/recetas/domain/receta-pdf-parser";
import type { LinkLite, RecetaPdfInput, TextItemLite } from "@/modules/recetas/domain/receta-pdf-parser";
import { coincideNormalizado, normalizarTexto } from "@/modules/recetas/domain/normalizar";

// ============================================================================
// Fixture helpers
// ============================================================================

/** One text item. */
function t(str: string, x: number, y: number, width: number, height = 11): TextItemLite {
  return { str, x, y, width, height };
}

/** A line of words starting at `x`, one item per word (like the real dump), widths approximated from the character count. */
function renglon(texto: string, x: number, y: number, height = 11): TextItemLite[] {
  const items: TextItemLite[] = [];
  let cursor = x;
  for (const palabra of texto.split(" ")) {
    const width = palabra.length * height * 0.45;
    items.push(t(palabra, cursor, y, width, height));
    cursor += width + 2.5;
  }
  return items;
}

const LINK_RCTA: LinkLite = { uri: "https://verumrp.com.ar/prescripcion/TESTHASH0001" };

const CUERPO_P1 = [
  "- Belgrano 250 Godoy Cruz",
  "Fluoxetina 20 mg",
  "Clonazepam 0,3 mg",
  "Cafeína 50 mg",
  "Picolinato de cromo 1,6 mg",
  "Hidroclorotiazida 25 mg",
  "Cloruro de potasio 100 mg",
  "30 comprimidos",
  "Media dosis cada 12 horas",
  "Tratamiento por 30 días",
];

interface OpcionesReceta {
  nroReceta?: string | null;
  paciente?: string;
  matriculaEncabezado?: string | null;
  cuerpo?: string[];
  diagnostico?: string | null;
  links?: LinkLite[];
  registro?: string | null;
}

/** A synthetic RCTA receta shaped after the real layout (fictitious data). */
function recetaRcta(opciones: OpcionesReceta = {}): RecetaPdfInput {
  const {
    nroReceta = "0200012345678",
    paciente = "Ana Suárez",
    matriculaEncabezado = "Matrícula Prov.:5120",
    cuerpo = CUERPO_P1,
    diagnostico = "Diagnóstico: E66.0 - OBESIDAD DEBIDA A EXCESO DE CALORIAS",
    links = [LINK_RCTA],
    registro = "RL-2024-100292307",
  } = opciones;

  const items: TextItemLite[] = [];
  // Header: barcode numbers (receta on the left, paciente's CUIL on the right).
  if (nroReceta) items.push(t(nroReceta, 34.4, 28.8, 79.5, 15.1));
  items.push(t("27289991114", 333.2, 28.8, 67.3, 15.1));
  // Médico block (center) + dates (right column, same visual lines).
  items.push(...renglon("Martín Ríos", 196.7, 48.4));
  items.push(...renglon("MÉDICO - MEDICINA GENERAL", 161.2, 58.4), ...renglon("Creada: 19/08/2026", 348.3, 58.4));
  if (matriculaEncabezado) items.push(...renglon(matriculaEncabezado, 183.6, 68.4));
  items.push(...renglon("Válida desde: 20/08/2026", 328.3, 68.4));
  // Paciente block.
  items.push(...renglon(`Paciente: ${paciente}`, 27, 82.4), ...renglon("Sexo: Femenino", 355.5, 82.4));
  items.push(...renglon("DNI: 28.999.111 | CUIL: 27-28999111-4", 27, 94.4), ...renglon("F. Nacimiento: 05/03/1981", 319.9, 94.4));
  items.push(...renglon("Cobertura pública exclusiva / Particulares | PLAN: No posee | N° Credencial: 27289991114", 27, 106.4));
  // Rp./ body.
  items.push(...renglon("Rp./", 27, 143.8, 13.7));
  let y = 158.8;
  for (const linea of cuerpo) {
    items.push(...renglon(linea, 27, y, 13.7));
    y += 11;
  }
  if (diagnostico) items.push(...renglon(diagnostico, 27, y + 1, 13.7));
  // Footer.
  items.push(...renglon("Dr. Martín Ríos", 315.3, 444.4), ...renglon("MEDICINA GENERAL", 305.8, 452.4), ...renglon("MP 5120", 329.5, 460.4));
  items.push(...renglon("Este documento ha sido firmado -electrónica o digitalmente según", 23.5, 471.2, 10.3), ...renglon("FIRMA Y SELLO", 315.3, 476.4));
  items.push(...renglon("MÉDICO - MEDICINA GENERAL", 163.7, 523.9), ...renglon("Martín Ríos", 199.2, 533.9));
  items.push(...renglon("San Martín 456 Ciudad Mendoza Teléfono 261 5550000", 133.6, 543.9));
  if (registro) items.push(...renglon(registro, 195.5, 570.4, 8.2));
  items.push(...renglon("Ver Link", 51.5, 575.9));

  return { pages: [items], links };
}

function parsearOk(input: RecetaPdfInput) {
  const resultado = parsearRecetaPdf(input);
  if (!resultado.ok) throw new Error(`expected ok, got ${resultado.error.codigo}`);
  return resultado;
}

// ============================================================================
// P1 -- the RCTA sample (synthetic equivalent)
// ============================================================================

describe("P1: RCTA receta (synthetic equivalent of the real sample)", () => {
  const { borrador, advertencias } = parsearOk(recetaRcta());
  const item = borrador.items[0]!;

  it("detects the RCTA emisor, the emisor's receta number (top-left barcode) and the verification URL", () => {
    expect(borrador.emisor).toBe("RCTA");
    expect(borrador.nroRecetaEmisor).toBe("0200012345678");
    expect(borrador.urlVerificacion).toBe(LINK_RCTA.uri);
  });

  it("reads the dates as ISO", () => {
    expect(borrador.fechaPrescripcion).toBe("2026-08-19");
    expect(borrador.fechaValidaDesde).toBe("2026-08-20");
  });

  it("reads the paciente, splitting a 2-word name without asking for confirmation", () => {
    expect(borrador.paciente).toEqual({
      nombre: { nombreCompleto: "Ana Suárez", nombre: "Ana", apellido: "Suárez", requiereConfirmacion: false },
      dni: "28999111",
      cuil: "27289991114",
      sexo: "Femenino",
      fechaNacimiento: "1981-03-05",
      nroCredencial: "27289991114",
    });
  });

  it("reads the médico from the upper block, with a PROVINCIAL matrícula and the footer's address/phone", () => {
    expect(borrador.medico).toEqual({
      nombre: { nombreCompleto: "Martín Ríos", nombre: "Martín", apellido: "Ríos", requiereConfirmacion: false },
      especialidad: "MEDICINA GENERAL",
      matricula: "5120",
      matriculaJurisdiccion: "PROVINCIAL",
      direccionRegistrada: "San Martín 456 Ciudad Mendoza",
      telefono: "261 5550000",
    });
  });

  it("builds ONE item with 6 POR_DOSIS principio-activo componentes, es-AR decimals included", () => {
    expect(borrador.items).toHaveLength(1);
    expect(item.componentes).toEqual([
      { drogaTexto: "Fluoxetina", cantidad: "20", unidadTexto: "mg", modoExpresion: "POR_DOSIS" },
      { drogaTexto: "Clonazepam", cantidad: "0.3", unidadTexto: "mg", modoExpresion: "POR_DOSIS" },
      { drogaTexto: "Cafeína", cantidad: "50", unidadTexto: "mg", modoExpresion: "POR_DOSIS" },
      { drogaTexto: "Picolinato de cromo", cantidad: "1.6", unidadTexto: "mg", modoExpresion: "POR_DOSIS" },
      { drogaTexto: "Hidroclorotiazida", cantidad: "25", unidadTexto: "mg", modoExpresion: "POR_DOSIS" },
      { drogaTexto: "Cloruro de potasio", cantidad: "100", unidadTexto: "mg", modoExpresion: "POR_DOSIS" },
    ]);
  });

  it("reads presentación (COMPRIMIDO x 30), fracción 0.5, posología and duración", () => {
    expect(item.formaFarmaceutica).toBe("COMPRIMIDO");
    expect(item.cantidadUnidades).toBe(30);
    expect(item.fraccionDosisPorUnidad).toBe("0.5");
    expect(item.posologia).toBe("Media dosis cada 12 horas");
    expect(item.duracionTratamientoDias).toBe(30);
  });

  it("reads the diagnóstico's CIE-10 code and description", () => {
    expect(borrador.diagnosticoCodigo).toBe("E66.0");
    expect(borrador.diagnosticoDescripcion).toBe("OBESIDAD DEBIDA A EXCESO DE CALORIAS");
  });

  it("drops the '- ...' line right after Rp./ silently and warns ONLY about units vs. duración (15 vs 30 días)", () => {
    expect(advertencias).toEqual([{ codigo: "UNIDADES_VS_DURACION", mensaje: "Las unidades alcanzan para 15 días; la receta indica 30." }]);
  });
});

// ============================================================================
// P2 -- unknown emisor
// ============================================================================

describe("P2: emisor detection", () => {
  it("rejects a PDF with no link and no recognizable registry number as 'formato no reconocido', prefilling nothing", () => {
    const resultado = parsearRecetaPdf(recetaRcta({ links: [], registro: null }));
    expect(resultado).toEqual({ ok: false, error: { codigo: "FORMATO_NO_RECONOCIDO", mensaje: "Formato de receta no reconocido." } });
  });

  it("does not accept a lookalike link on another host, nor an unknown registry number", () => {
    const resultado = parsearRecetaPdf(
      recetaRcta({ links: [{ uri: "https://verumrp.com.ar.example.net/prescripcion/X" }, { uri: "javascript:alert(1)" }], registro: "RL-2023-000000001" }),
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.codigo).toBe("FORMATO_NO_RECONOCIDO");
  });

  it("recognizes RCTA by its registry number alone (no link -> no verification URL)", () => {
    const { borrador } = parsearOk(recetaRcta({ links: [] }));
    expect(borrador.emisor).toBe("RCTA");
    expect(borrador.urlVerificacion).toBeNull();
  });

  it("recognizes RCTA by its link alone", () => {
    expect(parsearOk(recetaRcta({ registro: null })).borrador.emisor).toBe("RCTA");
  });

  it("a PDF with no text layer (scanned) is reported as such", () => {
    const resultado = parsearRecetaPdf({ pages: [[], [t("   ", 10, 10, 5)]], links: [LINK_RCTA] });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.codigo).toBe("SIN_TEXTO");
  });
});

// ============================================================================
// P3 -- unclassifiable body line
// ============================================================================

describe("P3: unclassifiable body line", () => {
  it("warns with the literal text and keeps parsing the rest", () => {
    const cuerpo = [...CUERPO_P1.slice(0, 7), "Preparar en farmacia magistral habilitada", ...CUERPO_P1.slice(7)];
    const { borrador, advertencias } = parsearOk(recetaRcta({ cuerpo }));
    expect(advertencias).toContainEqual({
      codigo: "RENGLON_NO_RECONOCIDO",
      mensaje: "No se reconoció el renglón «Preparar en farmacia magistral habilitada». Revisalo y cargalo a mano si corresponde.",
      texto: "Preparar en farmacia magistral habilitada",
    });
    expect(borrador.items[0]!.componentes).toHaveLength(6);
    expect(borrador.items[0]!.cantidadUnidades).toBe(30);
  });

  it("a '- ...' line is only ignored right after Rp./ -- later on it is warned about", () => {
    const cuerpo = [...CUERPO_P1.slice(1), "- nota al pie"];
    const { advertencias } = parsearOk(recetaRcta({ cuerpo }));
    expect(advertencias.map((a) => a.texto)).toContain("- nota al pie");
  });
});

// ============================================================================
// P4 -- no emisor receta number
// ============================================================================

describe("P4: missing emisor receta number", () => {
  it("cannot be imported", () => {
    const resultado = parsearRecetaPdf(recetaRcta({ nroReceta: null }));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.codigo).toBe("SIN_NRO_RECETA");
  });

  it("a number with fewer than 10 digits is not the receta number, and the right-hand CUIL barcode never stands in for it", () => {
    const resultado = parsearRecetaPdf(recetaRcta({ nroReceta: "123456789" }));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.codigo).toBe("SIN_NRO_RECETA");
  });
});

// ============================================================================
// P5 -- names of 3+ words
// ============================================================================

describe("P5: name split", () => {
  it("a 3-word paciente name takes the last word as apellido and requires confirmation", () => {
    const { borrador } = parsearOk(recetaRcta({ paciente: "María José Fernández" }));
    expect(borrador.paciente.nombre).toEqual({ nombreCompleto: "María José Fernández", nombre: "María José", apellido: "Fernández", requiereConfirmacion: true });
  });

  it("separarNombre: 2 words -> no confirmation; 4 words -> confirmation; 1 word -> apellido only, confirmation; blank -> null", () => {
    expect(separarNombre("Ana  Suárez")).toEqual({ nombreCompleto: "Ana Suárez", nombre: "Ana", apellido: "Suárez", requiereConfirmacion: false });
    expect(separarNombre("Juan Carlos de la Torre")?.requiereConfirmacion).toBe(true);
    expect(separarNombre("Suárez")).toEqual({ nombreCompleto: "Suárez", nombre: "", apellido: "Suárez", requiereConfirmacion: true });
    expect(separarNombre("   ")).toBeNull();
  });
});

// ============================================================================
// P7 -- normalization (the match itself is the application layer's)
// ============================================================================

describe("P7 (normalization): normalizarTexto / coincideNormalizado", () => {
  it("lowercases, strips diacritics, collapses and trims whitespace", () => {
    expect(normalizarTexto("  Cloruro   de POTASIO ")).toBe("cloruro de potasio");
    expect(normalizarTexto("Cafeína")).toBe("cafeina");
    expect(normalizarTexto("ÜNGÜENTO\tBÁSICO")).toBe("unguento basico");
  });

  it("a different accent matches; a misspelling does not (exact comparison, no fuzzy)", () => {
    expect(coincideNormalizado("Cafeína", "CAFEINA")).toBe(true);
    expect(coincideNormalizado("Picolinato de cromo", "picolinato  de  cromo")).toBe(true);
    expect(coincideNormalizado("Cafeina", "Cafeinna")).toBe(false);
  });
});

// ============================================================================
// Building blocks
// ============================================================================

describe("agruparRenglones", () => {
  it("groups items of one visual line despite small y jitter / different font sizes, sorted by x", () => {
    const renglones = agruparRenglones([t("mg", 60, 101, 10), t("Fluoxetina", 5, 100, 40, 13.7), t("20", 48, 100.5, 8), t("Otra", 5, 115, 20)]);
    expect(renglones.map((r) => r.texto)).toEqual(["Fluoxetina 20 mg", "Otra"]);
  });

  it("splits a row into segments at large horizontal gaps (two columns on one line)", () => {
    const [r] = agruparRenglones([...renglon("MÉDICO - MEDICINA GENERAL", 161, 58), ...renglon("Creada: 19/08/2026", 348, 58)]);
    expect(r!.texto).toBe("MÉDICO - MEDICINA GENERAL Creada: 19/08/2026");
    expect(r!.segmentos.map((s) => s.texto)).toEqual(["MÉDICO - MEDICINA GENERAL", "Creada: 19/08/2026"]);
  });
});

describe("clasificarRenglonCuerpo", () => {
  it("componente with each supported unit", () => {
    expect(clasificarRenglonCuerpo("Vitamina D3 1.000 UI")).toEqual({ clase: "componente", drogaTexto: "Vitamina D3", cantidad: "1000", unidadTexto: "UI" });
    expect(clasificarRenglonCuerpo("Urea 10%")).toEqual({ clase: "componente", drogaTexto: "Urea", cantidad: "10", unidadTexto: "%" });
    expect(clasificarRenglonCuerpo("Biotina 300 mcg")).toMatchObject({ clase: "componente", unidadTexto: "mcg" });
  });

  it("presentación by lexicon, accents and singular included", () => {
    expect(clasificarRenglonCuerpo("60 cápsulas")).toEqual({ clase: "presentacion", cantidadUnidades: 60, formaFarmaceutica: "CAPSULA" });
    expect(clasificarRenglonCuerpo("1 comprimido")).toEqual({ clase: "presentacion", cantidadUnidades: 1, formaFarmaceutica: "COMPRIMIDO" });
    expect(clasificarRenglonCuerpo("30 sobres")).toEqual({ clase: "otro" });
  });

  it("fracción and posología can hold on the same line; either alone too", () => {
    expect(clasificarRenglonCuerpo("Media dosis cada 12 horas")).toEqual({ clase: "indicacion", fraccion: true, posologia: true });
    expect(clasificarRenglonCuerpo("½ dosis")).toEqual({ clase: "indicacion", fraccion: true, posologia: false });
    expect(clasificarRenglonCuerpo("1 comprimido cada 8 hs")).toEqual({ clase: "indicacion", fraccion: false, posologia: true });
    expect(clasificarRenglonCuerpo("Tomar 2 veces al día")).toEqual({ clase: "indicacion", fraccion: false, posologia: true });
  });

  it("duración", () => {
    expect(clasificarRenglonCuerpo("Tratamiento por 60 días")).toEqual({ clase: "duracion", dias: 60 });
  });
});

describe("parsearDecimalEsAr / parsearFechaDdMmAaaa", () => {
  it("reads es-AR numbers", () => {
    expect(parsearDecimalEsAr("0,3")).toBe("0.3");
    expect(parsearDecimalEsAr("1,6")).toBe("1.6");
    expect(parsearDecimalEsAr("1.000")).toBe("1000");
    expect(parsearDecimalEsAr("1.250,50")).toBe("1250.5");
    expect(parsearDecimalEsAr("100")).toBe("100");
    expect(parsearDecimalEsAr("abc")).toBeNull();
  });

  it("reads dd/mm/aaaa and rejects impossible dates", () => {
    expect(parsearFechaDdMmAaaa("5/3/1981")).toBe("1981-03-05");
    expect(parsearFechaDdMmAaaa("31/02/2026")).toBeNull();
  });
});

describe("consistency and other warnings", () => {
  it("no warning when the units last exactly the prescribed days", () => {
    expect(controlarUnidadesVsDuracion({ cantidadUnidades: 60, posologia: "1 cada 12 horas", duracionTratamientoDias: 30 })).toBeNull();
    const cuerpo = CUERPO_P1.map((l) => (l === "30 comprimidos" ? "60 comprimidos" : l));
    expect(parsearOk(recetaRcta({ cuerpo })).advertencias).toEqual([]);
  });

  it("formats a fractional result es-AR", () => {
    expect(controlarUnidadesVsDuracion({ cantidadUnidades: 25, posologia: "cada 5 horas", duracionTratamientoDias: 5 })?.mensaje).toBe(
      "Las unidades alcanzan para 5,21 días; la receta indica 5.",
    );
  });

  it("warns when the body signals more than one item", () => {
    const cuerpo = [...CUERPO_P1, "Metformina 500 mg", "60 comprimidos"];
    const { advertencias } = parsearOk(recetaRcta({ cuerpo }));
    expect(advertencias.filter((a) => a.codigo === "MAS_DE_UN_ITEM")).toHaveLength(1);
  });

  it("without 'Diagnóstico:' the body ends at the footer, and missing header data is reported", () => {
    const { borrador, advertencias } = parsearOk(recetaRcta({ diagnostico: null, matriculaEncabezado: null }));
    expect(borrador.diagnosticoCodigo).toBeNull();
    expect(advertencias.filter((a) => a.codigo === "RENGLON_NO_RECONOCIDO")).toEqual([]);
    // Matrícula falls back to the footer's "MP NNNN".
    expect(borrador.medico.matricula).toBe("5120");
    expect(borrador.medico.matriculaJurisdiccion).toBe("PROVINCIAL");
  });

  it("warns when the header's matrícula and the footer's differ (the header's is kept)", () => {
    const { borrador, advertencias } = parsearOk(recetaRcta({ matriculaEncabezado: "Matrícula Prov.:5121" }));
    expect(borrador.medico.matricula).toBe("5121");
    expect(advertencias).toContainEqual({
      codigo: "MATRICULA_DISTINTA",
      mensaje: "La matrícula del encabezado (5121) no coincide con la del pie de la receta (5120). Se usa la del encabezado: verificala.",
    });
  });

  it("'Matrícula Nac.:' maps to NACIONAL", () => {
    expect(parsearOk(recetaRcta({ matriculaEncabezado: "Matrícula Nac.:98765" })).borrador.medico).toMatchObject({
      matricula: "98765",
      matriculaJurisdiccion: "NACIONAL",
    });
  });
});

// ============================================================================
// Pieces shared with the QR import (importacion-receta-qr spec, PDF delta P71)
// ============================================================================

describe("parsearCuerpo (shared by the PDF and the QR import)", () => {
  it("does NOT apply the PDF-only '- ' rule: a first '- ...' line is reported like any unrecognized line", () => {
    const { item, advertencias } = parsearCuerpo(["- Belgrano 250 Godoy Cruz", "Fluoxetina 20 mg", "30 comprimidos"]);
    expect(advertencias).toEqual([
      {
        codigo: "RENGLON_NO_RECONOCIDO",
        mensaje: "No se reconoció el renglón «- Belgrano 250 Godoy Cruz». Revisalo y cargalo a mano si corresponde.",
        texto: "- Belgrano 250 Godoy Cruz",
      },
    ]);
    expect(item.componentes).toHaveLength(1);
    expect(item.cantidadUnidades).toBe(30);
  });

  it("classifies the same lines the PDF does (same item and warnings)", () => {
    const { item, advertencias } = parsearCuerpo(["Mazindol 1,5 mg", "30 cápsulas", "Media dosis cada 12 horas", "Tratamiento por 30 días"]);
    expect(item).toEqual({
      formaFarmaceutica: "CAPSULA",
      cantidadUnidades: 30,
      fraccionDosisPorUnidad: "0.5",
      posologia: "Media dosis cada 12 horas",
      duracionTratamientoDias: 30,
      componentes: [{ drogaTexto: "Mazindol", cantidad: "1.5", unidadTexto: "mg", modoExpresion: "POR_DOSIS" }],
    });
    expect(advertencias.map((a) => a.codigo)).toEqual(["UNIDADES_VS_DURACION"]);
  });

  it("the PDF flow still drops the leading '- ' line silently (rule moved into the PDF strategy)", () => {
    const sinGuion = parsearOk(recetaRcta({ cuerpo: CUERPO_P1.slice(1) }));
    const conGuion = parsearOk(recetaRcta());
    expect(conGuion.borrador).toEqual(sinGuion.borrador);
    expect(conGuion.advertencias).toEqual(sinGuion.advertencias);
  });
});

describe("colapsar", () => {
  it("collapses runs of whitespace and trims", () => {
    expect(colapsar("  Ana \n  Suárez\t")).toBe("Ana Suárez");
    expect(colapsar("")).toBe("");
  });
});

describe("separarContactoMedico", () => {
  it("splits the address from the phone (with or without colon after Teléfono)", () => {
    expect(separarContactoMedico("San Martín 456 Ciudad Mendoza Teléfono 261 5550000")).toEqual({ direccion: "San Martín 456 Ciudad Mendoza", telefono: "261 5550000" });
    expect(separarContactoMedico("Belgrano 250 Godoy Cruz Telefono: (261) 555-0000")).toEqual({ direccion: "Belgrano 250 Godoy Cruz", telefono: "(261) 555-0000" });
  });

  it("returns null when there is no phone", () => {
    expect(separarContactoMedico("San Martín 456 Ciudad Mendoza")).toBeNull();
    expect(separarContactoMedico("")).toBeNull();
  });
});

describe("urlVerificacionRcta", () => {
  it("rebuilds the emisor's verification URL from the hash, and the emisor accepts it as its own", () => {
    const hash = "0123456789ABCDEF".repeat(4);
    const url = urlVerificacionRcta(hash);
    expect(url).toBe(`https://verumrp.com.ar/prescripcion/${hash}`);
    expect(esUrlVerificacionDeEmisor("RCTA", url)).toBe(true);
  });
});
