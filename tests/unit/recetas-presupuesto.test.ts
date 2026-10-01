/**
 * `recetas.presupuestar` (docs/specs/presupuesto-receta.md): the in-memory
 * ficha + cotización of an unsaved receta draft, through the REAL pipeline
 * and the REAL pure calculators, with only the loaders mocked (no DB).
 * Cases: normal price, parcial (CSP in cápsulas), incompleta (faltante),
 * no price rule, invalid items reported as messages (not thrown), and
 * nothing written (INV-R02). Plus the pure helpers of domain/presupuesto.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError } from "@/shared/errors";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
const FAKE_TX = { __fakeTx: true };
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn(FAKE_TX),
}));
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const U_G = "a0000000-0000-4000-a000-000000000001";
const U_MG = "a0000000-0000-4000-a000-000000000002";
const D_UREA = "b0000000-0000-4000-a000-000000000001";
const D_MAZINDOL = "b0000000-0000-4000-a000-000000000002";
const D_LACTOSA = "b0000000-0000-4000-a000-000000000003";
const D_BAJA = "b0000000-0000-4000-a000-000000000004";

const fichaRepo = {
  getUnidadesBase: vi.fn(async () => ({ MASA: { id: U_G, tipoMagnitud: "MASA", factorABase: "1", simbolo: "g" } })),
  getParametrosPesaje: vi.fn(async () => ({ precisionBalanza: "0.001", excesoPesadaPorcentaje: "0" })),
  getUnidadesParaBorrador: vi.fn(async () => new Map([
    [U_G, { ref: { id: U_G, tipoMagnitud: "MASA", factorABase: "1" }, vigente: true }],
    [U_MG, { ref: { id: U_MG, tipoMagnitud: "MASA", factorABase: "0.001" }, vigente: true }],
  ])),
  getDrogasParaBorrador: vi.fn(async () => new Map([
    [D_UREA, { nombre: "Urea", vigente: true }],
    [D_MAZINDOL, { nombre: "Mazindol", vigente: true }],
    [D_LACTOSA, { nombre: "Lactosa", vigente: true }],
    [D_BAJA, { nombre: "Droga vieja", vigente: false }],
  ])),
  insertFichaConLineas: vi.fn(),
};
vi.mock("@/modules/elaboracion/infrastructure/ficha-repository", () => fichaRepo);

const partidas = new Map<string, { id: string; cantidadDisponible: string; fechaVencimiento: string; fechaApertura: string | null; costoUnitario: string }[]>();
const cotizacionRepo = {
  jornadaActualTenant: vi.fn(async () => "2026-09-30"),
  getPartidasElegiblesDeDroga: vi.fn(async (_tx: unknown, _tenant: unknown, drogaId: string) => partidas.get(drogaId) ?? []),
  insertCotizacion: vi.fn(),
};
vi.mock("@/modules/precios/infrastructure/cotizacion-repository", () => cotizacionRepo);

const getReglaVigente = vi.fn();
vi.mock("@/modules/precios/infrastructure/regla-precio-repository", () => ({ getReglaVigente: (...a: unknown[]) => getReglaVigente(...a) }));

const { presupuestarRecetaQuery } = await import("@/modules/recetas/application/presupuestar-receta");
const { armarPresupuesto, itemsListosParaPresupuesto } = await import("@/modules/recetas/domain/presupuesto");

const SESSION: AuthenticatedSession = {
  usuario: { id: "u-1", email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(["cotizaciones.calcular"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

const cremaUrea = {
  formaFarmaceutica: "CREMA",
  cantidadUnidades: 1,
  fraccionDosisPorUnidad: "1",
  cantidadTotal: null,
  unidadTotalId: null,
  componentes: [{ drogaId: D_UREA, cantidad: "10", unidadMedidaId: U_G, modoExpresion: "TOTAL", esPrincipioActivo: true }],
};

/** docs/specs/ficha-tecnica.md T3: cápsulas with a CSP excipiente -> manual enrase. */
const capsulasMazindol = {
  formaFarmaceutica: "CAPSULA",
  cantidadUnidades: 30,
  fraccionDosisPorUnidad: "1",
  cantidadTotal: null,
  unidadTotalId: null,
  componentes: [
    { drogaId: D_MAZINDOL, cantidad: "3", unidadMedidaId: U_MG, modoExpresion: "POR_DOSIS", esPrincipioActivo: true },
    { drogaId: D_LACTOSA, cantidad: null, unidadMedidaId: U_G, modoExpresion: "CSP", esPrincipioActivo: false },
  ],
};

async function presupuestar(items: unknown[]) {
  return presupuestarRecetaQuery.execute({ items }, { session: SESSION });
}

beforeEach(() => {
  getReglaVigente.mockReset().mockResolvedValue({
    id: "r1",
    precioMinimo: "0",
    tramos: [{ costoHasta: null, margen: "50" }],
    vigenteDesde: new Date(),
    creadoPorNombre: "N",
    creadoPorApellido: "A",
  });
  partidas.clear();
  partidas.set(D_UREA, [{ id: "p-urea", cantidadDisponible: "100", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "2" }]);
  partidas.set(D_MAZINDOL, [{ id: "p-maz", cantidadDisponible: "1", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "100" }]);
  fichaRepo.insertFichaConLineas.mockClear();
  cotizacionRepo.insertCotizacion.mockClear();
});

describe("recetas.presupuestar", () => {
  it("prices a normal item: 10 g of urea at $2/g, margen 50% -> $30", async () => {
    const p = await presupuestar([cremaUrea]);
    expect(p).toEqual({
      ok: true,
      total: "30",
      totalCompleto: true,
      items: [{ indice: 1, ok: true, precioFinal: "30", costoInsumos: "20", esParcial: false, enraseManual: [], esIncompleta: false, faltantes: [] }],
      faltantesReceta: [],
    });
  });

  it("two items sharing a droga with stock for only one: the second is incompleta and the receta-level warning appears", async () => {
    // 15 g of urea; each item needs 10 g.
    partidas.set(D_UREA, [{ id: "p-urea", cantidadDisponible: "15", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "2" }]);
    const p = await presupuestar([cremaUrea, cremaUrea]);
    if (!p.ok) throw new Error(p.mensaje);
    expect(p.items[0]).toMatchObject({ ok: true, esIncompleta: false, costoInsumos: "20", precioFinal: "30" });
    expect(p.items[1]).toMatchObject({ ok: true, esIncompleta: true, faltantes: [{ drogaNombre: "Urea", cantidad: "5", unidadSimbolo: "g" }], costoInsumos: "10" });
    expect(p.faltantesReceta).toEqual([
      {
        drogaNombre: "Urea",
        requerida: "20",
        disponible: "15",
        unidadSimbolo: "g",
        mensaje: "Falta stock de Urea para toda la receta: se necesitan 20,000 g y hay 15,000 g disponibles.",
      },
    ]);
  });

  it("two items sharing a droga with stock for both: no warning, both fully costed", async () => {
    partidas.set(D_UREA, [{ id: "p-urea", cantidadDisponible: "20", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "2" }]);
    const p = await presupuestar([cremaUrea, cremaUrea]);
    if (!p.ok) throw new Error(p.mensaje);
    expect(p.items.map((i) => i.ok && i.esIncompleta)).toEqual([false, false]);
    expect(p.faltantesReceta).toEqual([]);
    expect(p.total).toBe("60");
  });

  it("the cumulative split follows the same reparto: the partida the first item opened is used first by the next", async () => {
    partidas.set(D_UREA, [
      { id: "p-vence-antes", cantidadDisponible: "12", fechaVencimiento: "2026-12-01", fechaApertura: null, costoUnitario: "1" },
      { id: "p-vence-despues", cantidadDisponible: "50", fechaVencimiento: "2027-06-01", fechaApertura: null, costoUnitario: "3" },
    ]);
    const p = await presupuestar([cremaUrea, cremaUrea]);
    if (!p.ok) throw new Error(p.mensaje);
    // Item 1: 10 g from the earliest-expiring partida ($10). Item 2: its remaining 2 g ($2) + 8 g from the other ($24).
    expect(p.items.map((i) => (i.ok ? i.costoInsumos : null))).toEqual(["10", "26"]);
  });

  it("CSP in cápsulas is parcial: the excipiente is completed when preparing and priced at 0", async () => {
    const p = await presupuestar([capsulasMazindol]);
    if (!p.ok) throw new Error(p.mensaje);
    const [item] = p.items;
    // 3 mg x 30 = 0.09 g of mazindol at $100/g = $9; +50% = $13.5.
    expect(item).toMatchObject({ ok: true, esParcial: true, enraseManual: ["Lactosa"], costoInsumos: "9", precioFinal: "13.5" });
  });

  it("not enough stock is incompleta, with what is missing per droga, priced with what exists", async () => {
    partidas.set(D_UREA, [{ id: "p-urea", cantidadDisponible: "4", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "2" }]);
    const p = await presupuestar([cremaUrea]);
    if (!p.ok) throw new Error(p.mensaje);
    expect(p.items[0]).toMatchObject({ ok: true, esIncompleta: true, faltantes: [{ drogaNombre: "Urea", cantidad: "6", unidadSimbolo: "g" }], precioFinal: "12" });
  });

  it("each item is priced on its OWN cost: tramo and floor per item, not on the receta's total", async () => {
    // Each item costs $20 (10 g x $2): tramo "<= 30 -> +50%" for each, although the receta's $40 would be in "> 30 -> +10%".
    // Floor $35 raises each $30 item to $35.
    partidas.set(D_UREA, [{ id: "p-urea", cantidadDisponible: "100", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "2" }]);
    getReglaVigente.mockResolvedValue({
      id: "r2",
      precioMinimo: "35",
      tramos: [
        { costoHasta: "30", margen: "50" },
        { costoHasta: null, margen: "10" },
      ],
      vigenteDesde: new Date(),
      creadoPorNombre: "N",
      creadoPorApellido: "A",
    });
    const p = await presupuestar([cremaUrea, cremaUrea]);
    if (!p.ok) throw new Error(p.mensaje);
    expect(p.items.map((i) => (i.ok ? i.precioFinal : null))).toEqual(["35", "35"]);
    expect(p.total).toBe("70");
  });

  it("without a price rule: one clear message, nothing priced", async () => {
    getReglaVigente.mockResolvedValue(null);
    expect(await presupuestar([cremaUrea])).toEqual({ ok: false, mensaje: expect.stringContaining("No hay regla de precios configurada") });
  });

  it("an invalid item gets a message instead of a price (not a throw); the others are still priced", async () => {
    const p = await presupuestar([{ ...cremaUrea, fraccionDosisPorUnidad: "2" }, cremaUrea, { ...cremaUrea, componentes: [{ ...cremaUrea.componentes[0], drogaId: D_BAJA }] }]);
    if (!p.ok) throw new Error(p.mensaje);
    expect(p.items[0]).toEqual({ indice: 1, ok: false, mensaje: "La fracción de dosis por unidad debe ser mayor que 0 y menor o igual a 1." });
    expect(p.items[1]).toMatchObject({ indice: 2, ok: true, precioFinal: "30" });
    expect(p.items[2]).toEqual({ indice: 3, ok: false, mensaje: "Una o más drogas o unidades del ítem no existen o están dadas de baja." });
    expect(p.total).toBe("30");
    expect(p.totalCompleto).toBe(false);
  });

  it("writes nothing: no ficha, no cotización (INV-R02)", async () => {
    await presupuestar([cremaUrea, capsulasMazindol]);
    expect(fichaRepo.insertFichaConLineas).not.toHaveBeenCalled();
    expect(cotizacionRepo.insertCotizacion).not.toHaveBeenCalled();
  });

  it("requires cotizaciones.calcular", async () => {
    await expect(presupuestarRecetaQuery.execute({ items: [cremaUrea] }, { session: { ...SESSION, permisos: new Set() as AuthenticatedSession["permisos"] } })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe("domain/presupuesto", () => {
  it("armarPresupuesto sums only the priced items", () => {
    const p = armarPresupuesto([
      { indice: 1, ok: true, precioFinal: "10.5", costoInsumos: "7", esParcial: false, enraseManual: [], esIncompleta: false, faltantes: [] },
      { indice: 2, ok: false, mensaje: "x" },
      { indice: 3, ok: true, precioFinal: "0.25", costoInsumos: "1", esParcial: false, enraseManual: [], esIncompleta: false, faltantes: [] },
    ]);
    expect(p).toMatchObject({ ok: true, total: "10.75", totalCompleto: false });
  });

  it("itemsListosParaPresupuesto: only a complete draft is priced", () => {
    const base = { cantidadUnidades: 1, fraccionDosisPorUnidad: "1", cantidadTotal: null, unidadTotalId: null };
    const comp = { drogaId: D_UREA, cantidad: "10", unidadMedidaId: U_G, modoExpresion: "TOTAL" as const };
    expect(itemsListosParaPresupuesto([{ ...base, componentes: [comp] }])).toBe(true);
    expect(itemsListosParaPresupuesto([{ ...base, componentes: [{ ...comp, modoExpresion: "CSP", cantidad: null }] }])).toBe(true);
    expect(itemsListosParaPresupuesto([])).toBe(false);
    expect(itemsListosParaPresupuesto([{ ...base, componentes: [{ ...comp, drogaId: "" }] }])).toBe(false);
    expect(itemsListosParaPresupuesto([{ ...base, componentes: [{ ...comp, unidadMedidaId: "" }] }])).toBe(false);
    expect(itemsListosParaPresupuesto([{ ...base, componentes: [{ ...comp, cantidad: "0" }] }])).toBe(false);
    expect(itemsListosParaPresupuesto([{ ...base, componentes: [{ ...comp, cantidad: "1,5" }] }])).toBe(false);
    expect(itemsListosParaPresupuesto([{ ...base, cantidadUnidades: Number.NaN, componentes: [comp] }])).toBe(false);
    expect(itemsListosParaPresupuesto([{ ...base, cantidadTotal: "30", componentes: [comp] }])).toBe(false); // total without its unit
  });
});
