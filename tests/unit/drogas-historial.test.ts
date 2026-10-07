/**
 * Unit tests for `modules/drogas/domain/historial.ts`: pure derivation of the droga
 * Historial (docs/specs/historial-droga.md): partida filter parsing, option helpers,
 * partida label, pagination clamp, URL builder and view-model assembly. No mocks, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  PAGE_SIZE_HISTORIAL_DROGA,
  PARTIDAS_FILTRO_MAX,
  armarHistorialDroga,
  calcularPaginacion,
  etiquetaPartidaOpcion,
  filtrarPartidasDeLaDroga,
  hrefHistorialDroga,
  parsearPartidaIds,
  partidasRestantes,
  partidasSeleccionadas,
} from "@/modules/drogas/domain/historial";
import type { HistorialDrogaCruda, PartidaOpcion } from "@/modules/drogas/domain/historial";

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P_AJENA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DROGA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const opcionA: PartidaOpcion = { id: P1, lote: "A-1", proveedor: "Droguería Sur", fechaVencimiento: new Date("2027-01-31T00:00:00Z") };
const opcionB: PartidaOpcion = { id: P2, lote: "B-2", proveedor: "Química Norte", fechaVencimiento: null };

describe("constants", () => {
  it("caps the filter at 20 and pages by 20", () => {
    expect(PARTIDAS_FILTRO_MAX).toBe(20);
    expect(PAGE_SIZE_HISTORIAL_DROGA).toBe(20);
  });
});

describe("parsearPartidaIds", () => {
  it("accepts a single value, a repeated param and nothing at all", () => {
    expect(parsearPartidaIds(undefined)).toEqual([]);
    expect(parsearPartidaIds(P1)).toEqual([P1]);
    expect(parsearPartidaIds([P1, P2])).toEqual([P1, P2]);
  });

  it("drops anything that is not a uuid, silently", () => {
    expect(parsearPartidaIds(["no-es-uuid", P1, "", "123", "' OR 1=1 --"])).toEqual([P1]);
    expect(parsearPartidaIds("zzz")).toEqual([]);
  });

  it("ignores non-string entries", () => {
    expect(parsearPartidaIds([P1, 42, null] as unknown as string[])).toEqual([P1]);
  });

  it("lowercases and deduplicates in first-seen order", () => {
    expect(parsearPartidaIds([P2.toUpperCase(), P1, P2, P1.toUpperCase()])).toEqual([P2, P1]);
  });

  it("caps the selection at PARTIDAS_FILTRO_MAX distinct valid ids", () => {
    const muchos = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const parsed = parsearPartidaIds(muchos);
    expect(parsed).toHaveLength(PARTIDAS_FILTRO_MAX);
    expect(parsed).toEqual(muchos.slice(0, PARTIDAS_FILTRO_MAX));
  });
});

describe("filtrarPartidasDeLaDroga / partidasSeleccionadas / partidasRestantes", () => {
  const disponibles = [opcionA, opcionB];

  it("keeps only requested ids that are one of the droga's own partidas (never trusted)", () => {
    expect(filtrarPartidasDeLaDroga([P_AJENA, P2], disponibles)).toEqual([P2]);
    expect(filtrarPartidasDeLaDroga([P_AJENA], disponibles)).toEqual([]);
    expect(filtrarPartidasDeLaDroga([P2, P1], disponibles)).toEqual([P2, P1]);
  });

  it("selected options come back in the options' order, whatever the order of the ids", () => {
    expect(partidasSeleccionadas(disponibles, [P2, P1]).map((p) => p.id)).toEqual([P1, P2]);
  });

  it("the remaining options exclude the selected ones and keep the order", () => {
    expect(partidasRestantes(disponibles, [P1]).map((p) => p.id)).toEqual([P2]);
    expect(partidasRestantes(disponibles, [])).toEqual(disponibles);
    expect(partidasRestantes(disponibles, [P1, P2])).toEqual([]);
  });
});

describe("etiquetaPartidaOpcion", () => {
  it("shows lote, proveedor and the vencimiento as dd/mm/aaaa (a Postgres date is UTC midnight)", () => {
    expect(etiquetaPartidaOpcion(opcionA)).toBe("Lote A-1 · Droguería Sur · vence 31/01/2027");
  });

  it("says 'sin vencimiento' for an insumo that does not expire", () => {
    expect(etiquetaPartidaOpcion(opcionB)).toBe("Lote B-2 · Química Norte · sin vencimiento");
  });
});

describe("calcularPaginacion", () => {
  it("clamps the page into [1, totalPages]", () => {
    expect(calcularPaginacion(45, 99, 20)).toEqual({ page: 3, pageSize: 20, total: 45, totalPages: 3 });
    expect(calcularPaginacion(45, -3, 20)).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
  });

  it("an empty result still has one page", () => {
    expect(calcularPaginacion(0, 5, 20)).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  });

  it("defaults the page size to PAGE_SIZE_HISTORIAL_DROGA", () => {
    expect(calcularPaginacion(41, 1).totalPages).toBe(3);
    expect(calcularPaginacion(41, 1).pageSize).toBe(PAGE_SIZE_HISTORIAL_DROGA);
  });
});

describe("hrefHistorialDroga", () => {
  const base = `/catalogos/drogas/${DROGA}/historial`;

  it("is the bare base without filter nor page", () => {
    expect(hrefHistorialDroga(base, [])).toBe(base);
  });

  it("repeats ?partida= once per id, in order", () => {
    expect(hrefHistorialDroga(base, [P1, P2])).toBe(`${base}?partida=${P1}&partida=${P2}`);
  });

  it("appends ?page= only past the first page", () => {
    expect(hrefHistorialDroga(base, [P1], 2)).toBe(`${base}?partida=${P1}&page=2`);
    expect(hrefHistorialDroga(base, [P1], 1)).toBe(`${base}?partida=${P1}`);
    expect(hrefHistorialDroga(base, [], 3)).toBe(`${base}?page=3`);
  });
});

describe("armarHistorialDroga", () => {
  const cruda = (over: Partial<HistorialDrogaCruda> = {}): HistorialDrogaCruda => ({
    droga: { id: DROGA, nombre: "Minoxidil", fechaBaja: null, unidadBaseId: "u-g", unidadBaseSimbolo: "g" },
    zonaHoraria: "America/Argentina/Mendoza",
    partidasDisponibles: [opcionA, opcionB],
    partidaIds: [],
    totalRecetas: 45,
    totalFiltradas: 45,
    page: 1,
    recetas: [
      { id: "r1", numeroInterno: "120", estado: "PREPARADA", preparadaEn: new Date("2026-10-01T15:00:00Z"), consumido: "12.5", medicoApellido: "Gómez", medicoNombre: "Ana" },
      { id: "r2", numeroInterno: "119", estado: "ANULADA", preparadaEn: new Date("2026-09-30T15:00:00Z"), consumido: "3", medicoApellido: "Ruiz", medicoNombre: "Luis" },
    ],
    pacientes: [{ recetaId: "r1", apellido: "Pérez", nombre: "Juan" }],
    partidasConsumidas: [
      { recetaId: "r1", partidaId: P1, lote: "A-1", proveedor: "Droguería Sur", fechaVencimiento: new Date("2027-01-31T00:00:00Z"), cantidad: "7.5" },
      { recetaId: "r1", partidaId: P2, lote: "B-2", proveedor: "Química Norte", fechaVencimiento: null, cantidad: "5" },
      { recetaId: "r2", partidaId: P1, lote: "A-1", proveedor: "Droguería Sur", fechaVencimiento: new Date("2027-01-31T00:00:00Z"), cantidad: "3" },
    ],
    ...over,
  });

  const TODO = { pacientes: true, stock: true };
  const NADA = { pacientes: false, stock: false };

  it("builds one row per receta with médico, paciente and its partidas in query order", () => {
    const h = armarHistorialDroga(cruda(), TODO);
    expect(h.recetas).toHaveLength(2);
    expect(h.recetas[0]).toMatchObject({ id: "r1", numeroInterno: "120", estado: "PREPARADA", medico: "Gómez, Ana", paciente: "Pérez, Juan", consumido: "12.5" });
    expect(h.recetas[0]!.partidas.map((p) => [p.partidaId, p.cantidad])).toEqual([
      [P1, "7.5"],
      [P2, "5"],
    ]);
    expect(h.recetas[1]!.partidas).toHaveLength(1);
  });

  it("a receta without a paciente row gets null even with the permiso", () => {
    expect(armarHistorialDroga(cruda(), TODO).recetas[1]!.paciente).toBeNull();
  });

  it("without pacientes access the paciente is null even if rows were handed in (defense in depth)", () => {
    const h = armarHistorialDroga(cruda(), NADA);
    expect(h.recetas.every((r) => r.paciente === null)).toBe(true);
    expect(JSON.stringify(h)).not.toContain("Pérez");
  });

  it("a receta with no consumed rows has an empty partidas list", () => {
    const h = armarHistorialDroga(cruda({ partidasConsumidas: [] }), TODO);
    expect(h.recetas[0]!.partidas).toEqual([]);
  });

  it("paginates over the FILTERED total, clamping the page; the unfiltered total and the applied filter are echoed", () => {
    const h = armarHistorialDroga(cruda({ totalFiltradas: 41, totalRecetas: 90, page: 9, partidaIds: [P1] }), TODO);
    expect(h.paginacion).toEqual({ page: 3, pageSize: 20, total: 41, totalPages: 3 });
    expect(h.totalRecetas).toBe(90);
    expect(h.partidaIds).toEqual([P1]);
  });

  it("carries the droga, the tenant time zone, the access flags and the options through", () => {
    const h = armarHistorialDroga(cruda(), NADA);
    expect(h.droga.nombre).toBe("Minoxidil");
    expect(h.zonaHoraria).toBe("America/Argentina/Mendoza");
    expect(h.acceso).toEqual(NADA);
    expect(h.partidasDisponibles).toEqual([opcionA, opcionB]);
  });
});
