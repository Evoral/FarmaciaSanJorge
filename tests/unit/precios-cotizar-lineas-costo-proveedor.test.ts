/**
 * Which costo de proveedor a cotización is quoted with and how it reaches the
 * calculator (openspec/specs/costos-proveedor/spec.md R26, R27, R34; CP14), with the
 * repositories mocked (no DB): `costosProveedorParaCotizar` (the choice) and
 * `cotizarLineas` / `cotizarItemsAcumulado` (the wiring).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Candidato = {
  id: string;
  drogaId: string;
  proveedorId: string;
  proveedorNombre: string;
  proveedorDeBaja: boolean;
  precioInformado: string;
  unidadPrecioSimbolo: string;
  costoUnitario: string;
  fechaPrecio: string;
  vigenteDesde: Date;
};

const candidatos: Candidato[] = [];
const getCostosProveedorVigentesDeDrogas = vi.fn(async (_tx: unknown, _tenant: unknown, drogaIds: readonly string[]) => candidatos.filter((c) => drogaIds.includes(c.drogaId)));
vi.mock("@/modules/costos-proveedor/infrastructure/costo-proveedor-repository", () => ({
  getCostosProveedorVigentesDeDrogas: (...a: [unknown, unknown, readonly string[]]) => getCostosProveedorVigentesDeDrogas(...a),
}));

const partidas = new Map<string, { id: string; cantidadDisponible: string; fechaVencimiento: string; fechaApertura: string | null; costoUnitario: string }[]>();
const cotizacionRepo = {
  jornadaActualTenant: vi.fn(async () => "2026-09-30"),
  getPartidasElegiblesDeDroga: vi.fn(async (_tx: unknown, _tenant: unknown, drogaId: string) => partidas.get(drogaId) ?? []),
  getUnidadesBaseDeDrogas: vi.fn(async (_tx: unknown, _tenant: unknown, drogaIds: string[]) => new Map(drogaIds.map((id) => [id, { factorABase: "1", tipoMagnitud: "MASA" }]))),
};
vi.mock("@/modules/precios/infrastructure/cotizacion-repository", () => cotizacionRepo);
vi.mock("@/modules/precios/infrastructure/regla-precio-repository", () => ({ getReglaVigente: vi.fn() }));

const { costosProveedorParaCotizar } = await import("@/modules/costos-proveedor/application/costos-proveedor-para-cotizar");
const { cotizarLineas, cotizarItemsAcumulado } = await import("@/modules/precios/application/cotizar-lineas");
const { presupuestoItemDesdeCotizacion } = await import("@/modules/recetas/domain/presupuesto");

const TX = { __fakeTx: true } as never;
const TENANT = "11111111-1111-1111-1111-111111111111";

function candidato(overrides: Partial<Candidato> & Pick<Candidato, "id" | "drogaId" | "proveedorId">): Candidato {
  return {
    proveedorNombre: `Proveedor ${overrides.proveedorId}`,
    proveedorDeBaja: false,
    precioInformado: "1000",
    unidadPrecioSimbolo: "kg",
    costoUnitario: "1",
    fechaPrecio: "2026-09-01",
    vigenteDesde: new Date("2026-09-01T10:00:00Z"),
    ...overrides,
  };
}

const GRAMO = { factorABase: "1", tipoMagnitud: "MASA" };
function lineaFicha(drogaId: string, orden: number, cantidadAPesar: string | null = "10", esEnraseManual = false) {
  return { drogaId, drogaNombre: drogaId.toUpperCase(), unidadSimbolo: "g", unidad: GRAMO, cantidadAPesar, esEnraseManual, orden };
}

const REGLAS = { precioMinimo: "0", tramos: [{ costoHasta: null, margen: "0" }] };

beforeEach(() => {
  candidatos.length = 0;
  partidas.clear();
  getCostosProveedorVigentesDeDrogas.mockClear();
  cotizacionRepo.getPartidasElegiblesDeDroga.mockClear();
});

describe("costosProveedorParaCotizar (R26, CP14)", () => {
  it("two proveedores: the one with the latest fecha_precio wins", async () => {
    candidatos.push(
      candidato({ id: "c-viejo", drogaId: "d1", proveedorId: "p1", fechaPrecio: "2026-08-01", costoUnitario: "1" }),
      candidato({ id: "c-nuevo", drogaId: "d1", proveedorId: "p2", fechaPrecio: "2026-09-15", costoUnitario: "9" }),
    );
    const elegidos = await costosProveedorParaCotizar(TX, TENANT, ["d1"]);

    expect(elegidos.get("d1")).toMatchObject({ costoProveedorId: "c-nuevo", proveedorId: "p2", costoUnitario: "9", fechaPrecio: "2026-09-15" });
  });

  it("same fecha_precio: the latest vigente_desde wins", async () => {
    candidatos.push(
      candidato({ id: "c-a", drogaId: "d1", proveedorId: "p1", vigenteDesde: new Date("2026-09-01T10:00:00Z") }),
      candidato({ id: "c-b", drogaId: "d1", proveedorId: "p2", vigenteDesde: new Date("2026-09-02T10:00:00Z") }),
    );
    expect((await costosProveedorParaCotizar(TX, TENANT, ["d1"])).get("d1")?.costoProveedorId).toBe("c-b");
  });

  it("a proveedor de baja is ignored even when its price is the most recent", async () => {
    candidatos.push(
      candidato({ id: "c-baja", drogaId: "d1", proveedorId: "p1", fechaPrecio: "2026-09-20", proveedorDeBaja: true }),
      candidato({ id: "c-ok", drogaId: "d1", proveedorId: "p2", fechaPrecio: "2026-08-01" }),
    );
    expect((await costosProveedorParaCotizar(TX, TENANT, ["d1"])).get("d1")?.costoProveedorId).toBe("c-ok");
  });

  it("a droga whose only costos belong to proveedores de baja, or that has none, is absent from the map (-> PARTIDAS)", async () => {
    candidatos.push(candidato({ id: "c-baja", drogaId: "d1", proveedorId: "p1", proveedorDeBaja: true }));
    const elegidos = await costosProveedorParaCotizar(TX, TENANT, ["d1", "d2"]);

    expect(elegidos.size).toBe(0);
  });

  it("returns the snapshot fields the cotización keeps (R32) and queries ONCE for all drogas", async () => {
    candidatos.push(
      candidato({ id: "c1", drogaId: "d1", proveedorId: "p1", proveedorNombre: "Droguería Sur", precioInformado: "40898", unidadPrecioSimbolo: "kg", costoUnitario: "0.040898", fechaPrecio: "2026-09-10" }),
      candidato({ id: "c2", drogaId: "d2", proveedorId: "p1" }),
    );
    const elegidos = await costosProveedorParaCotizar(TX, TENANT, ["d1", "d2"]);

    expect(elegidos.get("d1")).toEqual({
      costoProveedorId: "c1",
      proveedorId: "p1",
      proveedorNombre: "Droguería Sur",
      precioInformado: "40898",
      unidadPrecioSimbolo: "kg",
      costoUnitario: "0.040898",
      fechaPrecio: "2026-09-10",
    });
    expect(getCostosProveedorVigentesDeDrogas).toHaveBeenCalledTimes(1);
  });
});

describe("cotizarLineas -- wiring (R25, R27)", () => {
  it("a droga with costo de proveedor is PROVEEDOR; one without falls back to PARTIDAS in the same cotización", async () => {
    candidatos.push(candidato({ id: "c1", drogaId: "d1", proveedorId: "p1", costoUnitario: "5" }));
    partidas.set("d1", [{ id: "P1", cantidadDisponible: "100", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "1" }]);
    partidas.set("d2", [{ id: "P2", cantidadDisponible: "100", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "2" }]);

    const cot = await cotizarLineas(TX, TENANT, [lineaFicha("d1", 0), lineaFicha("d2", 1)], REGLAS);

    expect(cot.detalle.lineas.map((l) => l.fuente)).toEqual(["PROVEEDOR", "PARTIDAS"]);
    expect(cot.costoInsumos.toString()).toBe("70"); // 10 x 5 + 10 x 2
    expect(cot.detalle.lineas[1]!.partidas).toHaveLength(1);
  });

  it("looks the costos up once, for the non-manual drogas only; with none, the result is today's (every línea PARTIDAS)", async () => {
    partidas.set("d1", [{ id: "P1", cantidadDisponible: "100", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "3" }]);

    const cot = await cotizarLineas(TX, TENANT, [lineaFicha("d1", 0), lineaFicha("excipiente", 1, null, true)], REGLAS);

    expect(getCostosProveedorVigentesDeDrogas).toHaveBeenCalledTimes(1);
    expect(getCostosProveedorVigentesDeDrogas.mock.calls[0]![2]).toEqual(["d1"]);
    expect(cot.costoInsumos.toString()).toBe("30");
    expect(cot.detalle.lineas.every((l) => l.fuente === "PARTIDAS" && l.costoProveedor === undefined)).toBe(true);
    expect(cot.esParcial).toBe(true);
  });
});

describe("cotizarItemsAcumulado -- wiring (R30)", () => {
  it("loads the costos once for all items; the PROVEEDOR línea still takes simulated stock from the next item's partidas-costed one", async () => {
    candidatos.push(candidato({ id: "c1", drogaId: "d1", proveedorId: "p1", costoUnitario: "5" }));
    partidas.set("d1", [{ id: "P1", cantidadDisponible: "15", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "1" }]);

    const [primero, segundo] = await cotizarItemsAcumulado(TX, TENANT, [[lineaFicha("d1", 0)], [lineaFicha("d1", 0)]], REGLAS);

    expect(getCostosProveedorVigentesDeDrogas).toHaveBeenCalledTimes(1);
    expect(primero!.costoInsumos.toString()).toBe("50");
    expect(segundo!.costoInsumos.toString()).toBe("50");
    expect(segundo!.detalle.lineas[0]).toMatchObject({ fuente: "PROVEEDOR", faltante: "5" });
    expect(segundo!.esIncompleta).toBe(false);
  });

  it("presupuesto item: `fuentes` appear only when some línea is costed from a proveedor", async () => {
    candidatos.push(candidato({ id: "c1", drogaId: "d1", proveedorId: "p1", proveedorNombre: "Droguería Sur", costoUnitario: "5" }));
    partidas.set("d2", [{ id: "P2", cantidadDisponible: "100", fechaVencimiento: "2027-01-01", fechaApertura: null, costoUnitario: "2" }]);

    const [mixto] = await cotizarItemsAcumulado(TX, TENANT, [[lineaFicha("d1", 0), lineaFicha("d2", 1), lineaFicha("excipiente", 2, null, true)]], REGLAS);
    const [soloPartidas] = await cotizarItemsAcumulado(TX, TENANT, [[lineaFicha("d2", 0)]], REGLAS);

    const itemMixto = presupuestoItemDesdeCotizacion(1, mixto!);
    expect(itemMixto).toMatchObject({ ok: true, fuentes: [{ drogaNombre: "D1", fuente: "PROVEEDOR", proveedorNombre: "Droguería Sur" }, { drogaNombre: "D2", fuente: "PARTIDAS" }] });
    // The shortage of the proveedor línea (all of d1: no stock) is reported but does not make the item incomplete.
    expect(itemMixto).toMatchObject({ esIncompleta: false, faltantes: [{ drogaNombre: "D1", cantidad: "10", unidadSimbolo: "g" }] });
    expect(presupuestoItemDesdeCotizacion(1, soloPartidas!)).not.toHaveProperty("fuentes");
  });
});
