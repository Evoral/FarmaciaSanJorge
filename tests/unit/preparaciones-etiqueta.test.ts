/**
 * Etiqueta content (modules/preparaciones/domain/etiqueta.ts): vía per
 * forma, Rp/ selection and formatting, receta-number fallback, the
 * persisted text -- plus a smoke test of the PDF layout.
 */
import { describe, it, expect } from "vitest";
import {
  armarContenidoEtiqueta,
  componentesRp,
  formaSegunCantidad,
  formatearContenidoEtiqueta,
  formatearLineaRp,
  formatearMedicoEtiqueta,
  numeroRecetaEtiqueta,
  viaDeAdministracion,
} from "@/modules/preparaciones/domain/etiqueta";
import type { ComponenteEtiqueta, DatosEtiqueta } from "@/modules/preparaciones/domain/etiqueta";
import { buildEtiquetaPdf, tamanoFuenteRp } from "@/modules/preparaciones/infrastructure/etiqueta-pdf";

function componente(overrides: Partial<ComponenteEtiqueta>): ComponenteEtiqueta {
  return { drogaNombre: "Droga", cantidad: "1", unidadSimbolo: "mg", modoExpresion: "POR_DOSIS", esPrincipioActivo: false, orden: 1, ...overrides };
}

const DATOS: DatosEtiqueta = {
  formaFarmaceutica: "CAPSULA",
  cantidadUnidades: 30,
  componentes: [
    componente({ drogaNombre: "Mazindol", cantidad: "2", esPrincipioActivo: true, orden: 1 }),
    componente({ drogaNombre: "Lactosa", cantidad: null, modoExpresion: "CSP", orden: 2 }),
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
  it("lists only the principios activos, in orden", () => {
    const rp = componentesRp([
      componente({ drogaNombre: "B", esPrincipioActivo: true, orden: 3 }),
      componente({ drogaNombre: "Excipiente", orden: 1 }),
      componente({ drogaNombre: "A", esPrincipioActivo: true, orden: 2 }),
    ]);
    expect(rp.map((c) => c.drogaNombre)).toEqual(["A", "B"]);
  });

  it("with no activo flagged, lists every componente except CS/CSP", () => {
    const rp = componentesRp([
      componente({ drogaNombre: "Ácido salicílico", modoExpresion: "TOTAL", orden: 1 }),
      componente({ drogaNombre: "Agua", modoExpresion: "CS", cantidad: null, orden: 2 }),
      componente({ drogaNombre: "Vaselina", modoExpresion: "CSP", cantidad: null, orden: 3 }),
    ]);
    expect(rp.map((c) => c.drogaNombre)).toEqual(["Ácido salicílico"]);
  });

  it("formats 'Droga cantidad unidad' with es-AR decimals", () => {
    expect(formatearLineaRp({ drogaNombre: "Mazindol", cantidad: "2.000", unidadSimbolo: "mg" })).toBe("Mazindol 2 mg");
    expect(formatearLineaRp({ drogaNombre: "Clonazepam", cantidad: "0.3", unidadSimbolo: "mg" })).toBe("Clonazepam 0,3 mg");
    expect(formatearLineaRp({ drogaNombre: "Vaselina", cantidad: null, unidadSimbolo: "g" })).toBe("Vaselina");
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
      "Vence: ______",
      "Receta N 1520",
      "30 Cápsulas — Orales",
      "Conservar en lugar fresco y seco",
      "Médico Gómez, Ana  MAT MP 4521",
    ]);
    expect(texto).not.toContain("Pérez");
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
    const muchos = Array.from({ length: 12 }, (_, i) => componente({ drogaNombre: `Droga con un nombre bastante largo ${i + 1}`, esPrincipioActivo: true, orden: i + 1 }));
    const pdf = await buildEtiquetaPdf(armarContenidoEtiqueta({ ...DATOS, formaFarmaceutica: "SOLUCION", cantidadUnidades: 1, componentes: muchos, directorTecnico: null, tenantDomicilio: null }));
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
});
