/**
 * Preview of a supplier price list import (docs/specs/costos-proveedor.md R17-R19; CP3, CP5-CP7): `construirVistaPrevia` and
 * `evaluarFilasLista`, the pure rules the server builds the preview with and the browser re-evaluates on every edit.
 */
import { describe, it, expect } from "vitest";
import {
  ESTADOS_FILA_LISTA,
  construirVistaPrevia,
  evaluarFilasLista,
  mensajeFechaListaInvalida,
  mensajeListaYaImportada,
  parsearPrecioIngresado,
  resumirEstados,
  unidadPrecioInicial,
  type ContextoEvaluacionLista,
  type DrogaParaLista,
  type EntradaFilaLista,
  type UnidadParaLista,
  type VigenteParaLista,
} from "@/modules/costos-proveedor/domain/importacion-lista";
import type { FilaListaLeida } from "@/modules/costos-proveedor/domain/parsers/lista-xlsx-crystal";

const U_KG = "u-kg";
const U_G = "u-g";
const U_MG = "u-mg";
const U_L = "u-l";
const U_ML = "u-ml";
const U_U = "u-u";
const U_BAJA = "u-baja";

const UNIDADES: UnidadParaLista[] = [
  { id: U_KG, codigo: "KILOGRAMO", simbolo: "kg", tipoMagnitud: "MASA", factorABase: "1000", vigente: true },
  { id: U_G, codigo: "GRAMO", simbolo: "g", tipoMagnitud: "MASA", factorABase: "1", vigente: true },
  { id: U_MG, codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factorABase: "0.001", vigente: true },
  { id: U_L, codigo: "LITRO", simbolo: "L", tipoMagnitud: "VOLUMEN", factorABase: "1000", vigente: true },
  { id: U_ML, codigo: "MILILITRO", simbolo: "mL", tipoMagnitud: "VOLUMEN", factorABase: "1", vigente: true },
  { id: U_U, codigo: "UNIDAD", simbolo: "u", tipoMagnitud: "UNIDADES", factorABase: "1", vigente: true },
  { id: U_BAJA, codigo: "ONZA", simbolo: "oz", tipoMagnitud: "MASA", factorABase: "28349.5", vigente: false },
];

const PARACETAMOL: DrogaParaLista = { id: "d-paracetamol", nombre: "Paracetamol", tipoMagnitud: "MASA", unidadBaseId: U_MG };
const ACETAMINOFEN: DrogaParaLista = { id: "d-acetaminofen", nombre: "Acetaminofén", tipoMagnitud: "MASA", unidadBaseId: U_MG };
const ACEITE: DrogaParaLista = { id: "d-aceite", nombre: "Aceite de girasol", tipoMagnitud: "VOLUMEN", unidadBaseId: U_ML };
const CAPSULAS: DrogaParaLista = { id: "d-capsulas", nombre: "Cápsulas N°0", tipoMagnitud: "UNIDADES", unidadBaseId: U_U };
const DROGAS = [PARACETAMOL, ACETAMINOFEN, ACEITE, CAPSULAS];

const FECHA_LISTA = "2026-10-10";

function vigente(cambios: Partial<VigenteParaLista> = {}): VigenteParaLista {
  return {
    id: "v-1",
    drogaId: PARACETAMOL.id,
    precioInformado: "30000",
    unidadPrecioId: U_KG,
    unidadPrecioSimbolo: "kg",
    // 30.000 $/kg per mg (1 kg = 1.000.000 mg).
    costoUnitario: "0.03",
    fechaPrecio: "2026-09-01",
    ...cambios,
  };
}

function fila(numeroFila: number, descripcion: string, precio: string | null, presentacion: string | null = null): FilaListaLeida {
  return { numeroFila, descripcion, precio, presentacion };
}

function vistaPrevia(filas: FilaListaLeida[], extras: { aliases?: { aliasNormalizado: string; drogaId: string }[]; vigentes?: VigenteParaLista[] } = {}) {
  return construirVistaPrevia({ filas, drogas: DROGAS, aliases: extras.aliases ?? [], unidades: UNIDADES, vigentes: extras.vigentes ?? [], fechaLista: FECHA_LISTA });
}

describe("construirVistaPrevia -- matching (R17)", () => {
  it("matches by exact normalized name (case, accents, spacing and trailing punctuation do not matter)", () => {
    const { filas } = vistaPrevia([fila(2, "PARACETAMOL", "40898"), fila(3, "  acetaminofen  ", "1000"), fila(4, "ACEITE DE GIRASOL.", "1500")]);
    expect(filas.map((f) => [f.drogaId, f.via, f.estado])).toEqual([
      [PARACETAMOL.id, "NOMBRE", "ASOCIADA"],
      [ACETAMINOFEN.id, "NOMBRE", "ASOCIADA"],
      [ACEITE.id, "NOMBRE", "ASOCIADA"],
    ]);
    expect(filas[0]!.drogaNombre).toBe("Paracetamol");
  });

  it("a remembered synonym wins over the name", () => {
    // The list text "ACETAMINOFEN" IS a droga's name, but the pharmacy told us it means Paracetamol.
    const { filas } = vistaPrevia([fila(2, "ACETAMINOFEN", "40898")], { aliases: [{ aliasNormalizado: "acetaminofen", drogaId: PARACETAMOL.id }] });
    expect(filas[0]).toMatchObject({ drogaId: PARACETAMOL.id, drogaNombre: "Paracetamol", via: "ALIAS" });
  });

  it("a synonym text with a double space and control marker matches once normalized", () => {
    const { filas } = vistaPrevia([fila(2, "ZOLPIDEM TARTRATO Sicotrop L4", "90000")], {
      aliases: [{ aliasNormalizado: "zolpidem tartrato sicotrop l4", drogaId: PARACETAMOL.id }],
    });
    expect(filas[0]!.via).toBe("ALIAS");
  });

  it("leaves what does not match without droga: no fuzzy match, nothing is created", () => {
    const { filas } = vistaPrevia([fila(2, "PARACETAMOL 500", "1000"), fila(3, "Paracet", "1000")]);
    expect(filas.map((f) => [f.drogaId, f.via, f.unidadPrecioId, f.estado])).toEqual([
      [null, null, null, "SIN_ASOCIAR"],
      [null, null, null, "SIN_ASOCIAR"],
    ]);
  });

  it("never matches a presentation row (it is omitted whatever the droga)", () => {
    const { filas } = vistaPrevia([fila(2, "ACEITE DE GIRASOL Tambor X 200", "250000", "Tambor X 200")]);
    expect(filas[0]).toMatchObject({ drogaId: null, estado: "OMITIDA_PRESENTACION", presentacion: "Tambor X 200" });
  });
});

describe("construirVistaPrevia -- default unidad de precio (R6)", () => {
  it("starts at kg for a masa droga, L for a volumen one and u for unidades", () => {
    const { filas } = vistaPrevia([fila(2, "Paracetamol", "1"), fila(3, "Aceite de girasol", "1"), fila(4, "Cápsulas N°0", "1")]);
    expect(filas.map((f) => f.unidadPrecioId)).toEqual([U_KG, U_L, U_U]);
  });

  it("unidadPrecioInicial is null when the catalog has no vigente default for the magnitud", () => {
    expect(unidadPrecioInicial("MASA", UNIDADES.filter((u) => u.id !== U_KG))).toBeNull();
    expect(unidadPrecioInicial("MASA", UNIDADES.map((u) => (u.id === U_KG ? { ...u, vigente: false } : u)))).toBeNull();
  });
});

describe("construirVistaPrevia -- row states (R18)", () => {
  it("ASOCIADA for a new price with no vigente", () => {
    const { filas, resumen } = vistaPrevia([fila(2, "Paracetamol", "40898")]);
    expect(filas[0]).toMatchObject({ estado: "ASOCIADA", vigente: null, variacionPct: null, variacionAlta: false, mensaje: null });
    expect(resumen.ASOCIADA).toBe(1);
  });

  it("DUPLICADA flags EVERY row of a droga that appears twice; the other rows are unaffected (CP7)", () => {
    const { filas, resumen } = vistaPrevia([fila(2, "Paracetamol", "40000"), fila(3, "PARACETAMOL", "41000"), fila(4, "Aceite de girasol", "1500")]);
    expect(filas.map((f) => f.estado)).toEqual(["DUPLICADA", "DUPLICADA", "ASOCIADA"]);
    expect(resumen).toMatchObject({ DUPLICADA: 2, ASOCIADA: 1 });
  });

  it("a duplicate through a synonym and through the name is still the same droga", () => {
    const { filas } = vistaPrevia([fila(2, "Paracetamol", "40000"), fila(3, "Acetaminofen", "41000")], {
      aliases: [{ aliasNormalizado: "acetaminofen", drogaId: PARACETAMOL.id }],
    });
    expect(filas.map((f) => f.estado)).toEqual(["DUPLICADA", "DUPLICADA"]);
  });

  it.each([[null], ["0"], ["-5"]])("PRECIO_INVALIDO for the price %j, with a message (CP3)", (precio) => {
    const { filas } = vistaPrevia([fila(2, "Paracetamol", precio)]);
    expect(filas[0]).toMatchObject({ estado: "PRECIO_INVALIDO" });
    expect(filas[0]!.mensaje).toBeTruthy();
  });

  it("a row with no droga is SIN_ASOCIAR even with an invalid price (it is not imported anyway)", () => {
    expect(vistaPrevia([fila(2, "Desconocida", null)]).filas[0]!.estado).toBe("SIN_ASOCIAR");
  });

  it("MAS_ANTIGUA when the vigente has a later fecha_precio than the list (R9, CP5)", () => {
    const { filas } = vistaPrevia([fila(2, "Paracetamol", "40898")], { vigentes: [vigente({ fechaPrecio: "2026-10-11" })] });
    expect(filas[0]).toMatchObject({ estado: "MAS_ANTIGUA" });
    expect(filas[0]!.mensaje).toMatch(/11\/10\/2026/);
  });

  it("an older list is refused even when the price is the same", () => {
    const { filas } = vistaPrevia([fila(2, "Paracetamol", "30000")], { vigentes: [vigente({ fechaPrecio: "2026-10-11" })] });
    expect(filas[0]!.estado).toBe("MAS_ANTIGUA");
  });

  it("SIN_CAMBIOS for the same price, unit and date as the vigente (R10, CP6)", () => {
    const { filas } = vistaPrevia([fila(2, "Paracetamol", "30000")], { vigentes: [vigente({ fechaPrecio: FECHA_LISTA })] });
    expect(filas[0]).toMatchObject({ estado: "SIN_CAMBIOS", variacionPct: "0.0" });
  });

  it("the same price with a LATER date is ASOCIADA: a new version confirming the price (R10, CP6)", () => {
    const { filas } = vistaPrevia([fila(2, "Paracetamol", "30000")], { vigentes: [vigente({ fechaPrecio: "2026-09-01" })] });
    expect(filas[0]!.estado).toBe("ASOCIADA");
  });

  it("OMITIDA_PRESENTACION for presentation rows", () => {
    expect(vistaPrevia([fila(2, "X Bidon X 10", "1", "Bidon X 10")]).filas[0]!.estado).toBe("OMITIDA_PRESENTACION");
  });

  it("counts every state; the counts add up to the rows", () => {
    const { filas, resumen } = vistaPrevia(
      [
        fila(2, "Paracetamol", "30000"), // SIN_CAMBIOS
        fila(3, "Aceite de girasol", "1500"), // ASOCIADA
        fila(4, "Cápsulas N°0", "0"), // PRECIO_INVALIDO
        fila(5, "Acetaminofén", "1000"), // DUPLICADA
        fila(6, "ACETAMINOFEN", "1100"), // DUPLICADA
        fila(7, "Desconocida", "5"), // SIN_ASOCIAR
        fila(8, "ACEITE Tambor X 200", "9", "Tambor X 200"), // OMITIDA_PRESENTACION
      ],
      { vigentes: [vigente({ fechaPrecio: FECHA_LISTA })] },
    );
    expect(resumen).toEqual({ ASOCIADA: 1, SIN_ASOCIAR: 1, DUPLICADA: 2, PRECIO_INVALIDO: 1, MAS_ANTIGUA: 0, SIN_CAMBIOS: 1, OMITIDA_PRESENTACION: 1, OMITIDA: 0 });
    expect(Object.keys(resumen).sort()).toEqual([...ESTADOS_FILA_LISTA].sort());
    expect(Object.values(resumen).reduce((a, b) => a + b, 0)).toBe(filas.length);
  });
});

describe("construirVistaPrevia -- variation (R18)", () => {
  const variacion = (precio: string, vigenteCambios: Partial<VigenteParaLista> = {}) => {
    const { filas } = vistaPrevia([fila(2, "Paracetamol", precio)], { vigentes: [vigente(vigenteCambios)] });
    return { pct: filas[0]!.variacionPct, alta: filas[0]!.variacionAlta };
  };

  it("is (nuevo - vigente) / vigente, with one decimal, signed", () => {
    expect(variacion("33000")).toEqual({ pct: "10.0", alta: false });
    expect(variacion("27000")).toEqual({ pct: "-10.0", alta: false });
    expect(variacion("40898")).toEqual({ pct: "36.3", alta: false });
  });

  it("is highlighted ABOVE ±50 %, not at exactly 50", () => {
    expect(variacion("45000")).toEqual({ pct: "50.0", alta: false });
    expect(variacion("45001")).toEqual({ pct: "50.0", alta: true });
    expect(variacion("60000")).toEqual({ pct: "100.0", alta: true });
    expect(variacion("15000")).toEqual({ pct: "-50.0", alta: false });
    expect(variacion("14999")).toEqual({ pct: "-50.0", alta: true });
    expect(variacion("6000")).toEqual({ pct: "-80.0", alta: true });
  });

  it("compares the cost per unidad base, so a change of unit does not read as a 1000x jump", () => {
    // 30 $/g is 30.000 $/kg: no variation. The vigente is in kg, the list row is typed in g.
    const entradas: EntradaFilaLista[] = [{ drogaId: PARACETAMOL.id, precio: "30", unidadPrecioId: U_G, omitida: false, presentacion: null }];
    const contexto = contextoDe([vigente()]);
    expect(evaluarFilasLista(contexto, entradas)[0]).toMatchObject({ variacionPct: "0.0", variacionAlta: false, costoUnitario: "0.03" });
  });

  it("is null without a vigente", () => {
    const { filas } = vistaPrevia([fila(2, "Paracetamol", "33000")]);
    expect(filas[0]).toMatchObject({ variacionPct: null, variacionAlta: false });
  });
});

function contextoDe(vigentes: VigenteParaLista[] = [], fechaLista = FECHA_LISTA): ContextoEvaluacionLista {
  return {
    fechaLista,
    drogas: new Map(DROGAS.map((d) => [d.id, d])),
    unidades: new Map(UNIDADES.map((u) => [u.id, u])),
    vigentePorDroga: new Map(vigentes.map((v) => [v.drogaId, v])),
  };
}

describe("evaluarFilasLista -- the browser's re-evaluation after an edit", () => {
  const base = (cambios: Partial<EntradaFilaLista> = {}): EntradaFilaLista => ({ drogaId: PARACETAMOL.id, precio: "40898", unidadPrecioId: U_KG, omitida: false, presentacion: null, ...cambios });
  const estados = (entradas: EntradaFilaLista[], vigentes: VigenteParaLista[] = []) => evaluarFilasLista(contextoDe(vigentes), entradas).map((e) => e.estado);

  it("omitting one of two duplicated rows resolves the group (CP7)", () => {
    expect(estados([base(), base({ precio: "41000" })])).toEqual(["DUPLICADA", "DUPLICADA"]);
    expect(estados([base(), base({ precio: "41000", omitida: true })])).toEqual(["ASOCIADA", "OMITIDA"]);
  });

  it("picking a droga for a SIN_ASOCIAR row makes it ASOCIADA; clearing it makes it SIN_ASOCIAR again", () => {
    expect(estados([base({ drogaId: null, unidadPrecioId: null })])).toEqual(["SIN_ASOCIAR"]);
    expect(estados([base()])).toEqual(["ASOCIADA"]);
  });

  it("picking a droga that already has another row duplicates both (the duplicate group follows the droga, not the text)", () => {
    expect(estados([base(), base({ drogaId: null, unidadPrecioId: null })])).toEqual(["ASOCIADA", "SIN_ASOCIAR"]);
    expect(estados([base(), base()])).toEqual(["DUPLICADA", "DUPLICADA"]);
  });

  it("an OMITIDA row does not collide with anyone", () => {
    expect(estados([base({ omitida: true }), base(), base({ omitida: true })])).toEqual(["OMITIDA", "ASOCIADA", "OMITIDA"]);
  });

  it("a presentation row is always omitted, even if the user had it 'included'", () => {
    expect(estados([base({ presentacion: "Bidon X 10", omitida: false })])).toEqual(["OMITIDA_PRESENTACION"]);
  });

  it("a unit of another magnitud than the droga's is PRECIO_INVALIDO with the magnitud message (R5, CP2)", () => {
    const [evaluacion] = evaluarFilasLista(contextoDe(), [base({ unidadPrecioId: U_L })]);
    expect(evaluacion!.estado).toBe("PRECIO_INVALIDO");
    expect(evaluacion!.mensaje).toMatch(/misma magnitud/);
  });

  it("a unit dada de baja, a missing unit and an unknown unit are PRECIO_INVALIDO", () => {
    expect(estados([base({ unidadPrecioId: U_BAJA })])).toEqual(["PRECIO_INVALIDO"]);
    expect(estados([base({ unidadPrecioId: null })])).toEqual(["PRECIO_INVALIDO"]);
    expect(estados([base({ unidadPrecioId: "inexistente" })])).toEqual(["PRECIO_INVALIDO"]);
  });

  it("a price so low that the cost rounds to zero is PRECIO_INVALIDO", () => {
    expect(estados([base({ precio: "0.000001" })])).toEqual(["PRECIO_INVALIDO"]);
  });

  it("changing the unit changes the cost it implies (CP1): 40898 per kg is 0,040898 per mg; per g it is 40,898", () => {
    const [enKg, enG] = evaluarFilasLista(contextoDe(), [base(), base({ drogaId: ACETAMINOFEN.id, unidadPrecioId: U_G })]);
    expect(enKg!.costoUnitario).toBe("0.040898");
    expect(enG!.costoUnitario).toBe("40.898");
  });

  it("the price is read as typed: es-AR with a comma, plain with a dot", () => {
    const [a, b, c] = evaluarFilasLista(contextoDe(), [
      base({ precio: "40.898,50" }),
      base({ drogaId: ACETAMINOFEN.id, precio: "40898.5" }),
      base({ drogaId: ACEITE.id, precio: "abc", unidadPrecioId: U_L }),
    ]);
    expect([a!.precioCanonico, b!.precioCanonico, c!.precioCanonico]).toEqual(["40898.5", "40898.5", null]);
    expect(c!.estado).toBe("PRECIO_INVALIDO");
  });

  it("evaluates the same droga against the vigente the browser holds for it (picked droga, picked vigente)", () => {
    const vigentes = [vigente({ drogaId: ACETAMINOFEN.id, fechaPrecio: "2026-10-12" })];
    expect(estados([base({ drogaId: ACETAMINOFEN.id })], vigentes)).toEqual(["MAS_ANTIGUA"]);
    expect(estados([base({ drogaId: PARACETAMOL.id })], vigentes)).toEqual(["ASOCIADA"]);
  });

  it("resumirEstados counts what evaluarFilasLista returned", () => {
    const evaluaciones = evaluarFilasLista(contextoDe(), [base(), base({ drogaId: null, unidadPrecioId: null }), base({ omitida: true, drogaId: ACEITE.id, unidadPrecioId: U_L })]);
    expect(resumirEstados(evaluaciones)).toMatchObject({ ASOCIADA: 1, SIN_ASOCIAR: 1, OMITIDA: 1, DUPLICADA: 0 });
  });
});

describe("parsearPrecioIngresado", () => {
  it.each([
    ["40898", "40898"],
    ["40898.5", "40898.5"],
    ["1.25", "1.25"], // an unambiguous dot (not 3 fractional digits) is a DECIMAL point: what the preview shows reads back unchanged
    ["007.50", "7.5"],
    ["40.898,50", "40898.5"],
    ["40898,5", "40898.5"],
    ["  $ 1.234,5 ", "1234.5"],
    ["0", "0"],
  ])("%j -> %j", (texto, canonico) => {
    expect(parsearPrecioIngresado(texto)).toBe(canonico);
  });

  it.each([[""], ["   "], ["abc"], ["1e3"], ["1.125"], ["-5"], ["1,2,3"], ["12.5.1"], [null], [undefined]])("%j is not a price", (texto) => {
    expect(parsearPrecioIngresado(texto as string | null | undefined)).toBeNull();
  });
});

describe("the list's own fields", () => {
  it("accepts a real date not after the jornada; refuses a future or impossible one (R8)", () => {
    expect(mensajeFechaListaInvalida("2026-10-15", "2026-10-15")).toBeNull();
    expect(mensajeFechaListaInvalida("2026-01-01", "2026-10-15")).toBeNull();
    expect(mensajeFechaListaInvalida("2026-10-16", "2026-10-15")).toBe("La fecha de la lista no puede ser posterior a hoy.");
    expect(mensajeFechaListaInvalida("2026-02-31", "2026-10-15")).toBe("La fecha de la lista debe ser una fecha válida.");
    expect(mensajeFechaListaInvalida("", "2026-10-15")).toBe("La fecha de la lista debe ser una fecha válida.");
    expect(mensajeFechaListaInvalida("15/10/2026", "2026-10-15")).toBe("La fecha de la lista debe ser una fecha válida.");
  });

  it("words the duplicate import (R21)", () => {
    expect(mensajeListaYaImportada("12/10/2026")).toBe("Esta lista ya fue importada para este proveedor el 12/10/2026.");
  });
});
