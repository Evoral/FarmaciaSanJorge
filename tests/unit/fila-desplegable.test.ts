/**
 * Unit tests for the expandable-row table pieces of the Trayectoria views:
 * `shared/ui/fila-desplegable.tsx` (initial, closed render) and the summary
 * cells / column counts of `trayectoria-receta-fila.tsx` and
 * `trayectoria-partida-fila.tsx`. The unit project runs in a node environment
 * (no DOM), so these render to static markup; the click / keyboard toggle is
 * not covered here.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { FilaDesplegable, idDetalleFila } from "@/shared/ui/fila-desplegable";
import { TrayectoriaRecetaCeldas, columnasTablaRecetas, etiquetaReceta } from "@/modules/pacientes/ui/trayectoria-receta-fila";
import { TrayectoriaPartidaCeldas, columnasTablaPartidas, etiquetaPartida } from "@/modules/proveedores/ui/trayectoria-partida-fila";
import type { AccesoTrayectoria, RecetaTrayectoria } from "@/modules/pacientes/domain/trayectoria";
import type { AccesoTrayectoriaProveedor, PartidaTrayectoria } from "@/modules/proveedores/domain/trayectoria";
import { crearCatalogoUnidades } from "@/shared/format/cantidad";

const contar = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
const enFila = (celdas: unknown) => renderToStaticMarkup(createElement("table", null, createElement("tbody", null, createElement("tr", null, celdas as never))));

describe("FilaDesplegable (initial render)", () => {
  const html = renderToStaticMarkup(
    createElement("table", null, createElement("tbody", null, createElement(FilaDesplegable, {
      id: "abc",
      etiqueta: "Receta Nº 123",
      colSpan: 3,
      celdas: createElement("td", null, "resumen"),
      detalle: createElement("p", null, "contenido del detalle"),
    }))),
  );

  it("starts closed: collapsed toggle with an accessible label and no detail row", () => {
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Ver detalle de Receta Nº 123"');
    expect(html).toContain(`aria-controls="${idDetalleFila("abc")}"`);
    expect(html).toContain("resumen");
    expect(html).not.toContain("contenido del detalle");
    expect(contar(html, "tr")).toBe(1);
  });

  it("renders the toggle in the first cell, before the caller's cells", () => {
    expect(html.indexOf("<button")).toBeLessThan(html.indexOf("resumen"));
  });
});

const recetaBase = {
  id: "r1",
  numeroInterno: "42",
  fechaIngreso: new Date("2026-09-01T12:00:00Z"),
  fechaPrescripcion: new Date("2026-08-30T00:00:00Z"),
  medico: "Pérez, Ana",
  origen: "PRESENCIAL",
  estado: "ENTREGADA",
  motivoAnulacion: null,
  items: [],
  presupuesto: { total: "1500", itemsCotizados: 1, itemsSinCotizar: 0, esParcial: false, esIncompleta: false },
  entrega: null,
  lote: null,
  pasos: [],
} as unknown as RecetaTrayectoria;

describe("recetas table columns", () => {
  const sinPermisos: AccesoTrayectoria = { presupuesto: false, preparacion: false, libro: false, archivo: false, linkReceta: false, linkEntrega: false };
  const conPresupuesto: AccesoTrayectoria = { ...sinPermisos, presupuesto: true };

  it("summary cells + toggle cell always add up to colSpan", () => {
    for (const acceso of [sinPermisos, conPresupuesto]) {
      const celdas = enFila(createElement(TrayectoriaRecetaCeldas, { receta: recetaBase, acceso, zonaHoraria: "America/Argentina/Buenos_Aires" }));
      expect(contar(celdas, "td") + 1).toBe(columnasTablaRecetas(acceso));
    }
  });

  it("the presupuesto cell only exists with acceso.presupuesto", () => {
    const con = enFila(createElement(TrayectoriaRecetaCeldas, { receta: recetaBase, acceso: conPresupuesto, zonaHoraria: "UTC" }));
    const sin = enFila(createElement(TrayectoriaRecetaCeldas, { receta: recetaBase, acceso: sinPermisos, zonaHoraria: "UTC" }));
    expect(con).toContain("1.500");
    expect(sin).not.toContain("1.500");
  });

  it("labels the row by its número interno", () => {
    expect(etiquetaReceta(recetaBase)).toBe("Receta Nº 42");
  });
});

const partidaBase = {
  id: "p1",
  drogaNombre: "Minoxidil",
  unidadBaseId: "u-g",
  unidadBaseSimbolo: "g",
  lote: "L-77",
  fechaIngreso: new Date("2026-09-01T00:00:00Z"),
  fechaVencimiento: new Date("2027-01-31T00:00:00Z"),
  fechaApertura: null,
  cantidadInicial: "100",
  cantidadDisponible: "40",
  estado: "VIGENTE",
  costoUnitario: "2.5",
  movimientos: { items: [], total: 0, hayMas: false },
  preparaciones: null,
  contralor: null,
  correcciones: null,
} as unknown as PartidaTrayectoria;

describe("partidas table columns", () => {
  const sinCostos: AccesoTrayectoriaProveedor = { costos: false, preparaciones: false, contralor: false, correcciones: false, linkPartida: false };
  const conCostos: AccesoTrayectoriaProveedor = { ...sinCostos, costos: true };
  const catalogo = crearCatalogoUnidades([]);

  it("summary cells + toggle cell always add up to colSpan", () => {
    for (const acceso of [sinCostos, conCostos]) {
      const celdas = enFila(createElement(TrayectoriaPartidaCeldas, { partida: partidaBase, acceso, zonaHoraria: "UTC", catalogo }));
      expect(contar(celdas, "td") + 1).toBe(columnasTablaPartidas(acceso));
    }
  });

  it("the costo cell only exists with acceso.costos", () => {
    const con = enFila(createElement(TrayectoriaPartidaCeldas, { partida: partidaBase, acceso: conCostos, zonaHoraria: "UTC", catalogo }));
    const sin = enFila(createElement(TrayectoriaPartidaCeldas, { partida: partidaBase, acceso: sinCostos, zonaHoraria: "UTC", catalogo }));
    expect(con).toContain("/ g");
    expect(sin).not.toContain("/ g");
  });

  it("labels the row by lote and droga", () => {
    expect(etiquetaPartida(partidaBase)).toBe("Partida lote L-77 de Minoxidil");
  });
});
