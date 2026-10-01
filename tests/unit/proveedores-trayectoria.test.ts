/**
 * Unit tests for `modules/proveedores/domain/trayectoria.ts`: pure derivation of
 * the proveedor Trayectoria (derived partida estado with the stock alerts'
 * rules, correcciones de costo, block gating, pagination) plus the shared
 * money formatters it renders with. No mocks, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  ESTADOS_PARTIDA,
  armarTrayectoriaProveedor,
  calcularPaginacion,
  correccionDeCosto,
  derivarEstadoPartida,
  fechaCalendario,
  parseDiasAlertaVencimiento,
  sumarDiasAJornada,
} from "@/modules/proveedores/domain/trayectoria";
import type {
  AccesoTrayectoriaProveedor,
  AuditoriaCostoCruda,
  ContralorCrudo,
  MovimientoCrudo,
  PartidaCruda,
  PreparacionCruda,
  TrayectoriaProveedorCruda,
} from "@/modules/proveedores/domain/trayectoria";
import { formatearCostoUnitario, formatearMonto } from "@/shared/format/monto";
import { jornadaDe } from "@/shared/time/jornada";

/** A Postgres `date` arrives as UTC midnight. */
const fecha = (iso: string) => new Date(`${iso}T00:00:00Z`);
const instante = (iso: string) => new Date(iso);

const JORNADA = "2026-10-01";
const CTX = { jornada: JORNADA, diasAlerta: 30 };
const estado = (cantidadDisponible: string, venc: string, apertura: Date | null = null, ctx = CTX) =>
  derivarEstadoPartida({ cantidadDisponible, fechaVencimiento: fecha(venc), fechaApertura: apertura }, ctx);

describe("derivarEstadoPartida -- priority order", () => {
  it("exposes the five estados, highest priority first", () => {
    expect(ESTADOS_PARTIDA).toEqual(["AGOTADA", "VENCIDA", "POR_VENCER", "ABIERTA", "VIGENTE"]);
  });

  it("AGOTADA beats VENCIDA: a past-due partida without balance is just agotada", () => {
    expect(estado("0", "2026-01-01")).toBe("AGOTADA");
    expect(estado("0.0000", "2026-01-01")).toBe("AGOTADA");
  });

  it("AGOTADA beats POR_VENCER and ABIERTA", () => {
    expect(estado("0", "2026-10-10")).toBe("AGOTADA");
    expect(estado("0", "2027-10-10", new Date("2026-09-01T12:00:00Z"))).toBe("AGOTADA");
  });

  it("VENCIDA beats POR_VENCER and ABIERTA", () => {
    expect(estado("5", "2026-09-30")).toBe("VENCIDA");
    expect(estado("5", "2026-09-30", new Date("2026-09-01T12:00:00Z"))).toBe("VENCIDA");
  });

  it("POR_VENCER beats ABIERTA", () => {
    expect(estado("5", "2026-10-15", new Date("2026-09-01T12:00:00Z"))).toBe("POR_VENCER");
  });

  it("ABIERTA beats VIGENTE; VIGENTE is the fallback", () => {
    expect(estado("5", "2027-10-01", new Date("2026-09-01T12:00:00Z"))).toBe("ABIERTA");
    expect(estado("5", "2027-10-01")).toBe("VIGENTE");
  });
});

describe("derivarEstadoPartida -- boundaries (same as alertasVencidasConSaldo / alertasPorVencer)", () => {
  it("expiring TODAY is not vencida yet: vencida is strictly before the jornada", () => {
    expect(estado("5", "2026-09-30")).toBe("VENCIDA");
    expect(estado("5", "2026-10-01")).toBe("POR_VENCER");
  });

  it("the window is inclusive on both ends: [jornada, jornada + dias]", () => {
    expect(estado("5", "2026-10-31")).toBe("POR_VENCER"); // jornada + 30
    expect(estado("5", "2026-11-01")).toBe("VIGENTE"); // jornada + 31
  });

  it("honors the configured window", () => {
    const ctx = { jornada: JORNADA, diasAlerta: 7 };
    expect(estado("5", "2026-10-08", null, ctx)).toBe("POR_VENCER");
    expect(estado("5", "2026-10-09", null, ctx)).toBe("VIGENTE");
  });

  it("any positive balance counts, however small", () => {
    expect(estado("0.0001", "2026-09-30")).toBe("VENCIDA");
  });

  it("agrees with an independent day-count rule over a whole grid of vencimientos", () => {
    const base = Date.parse(`${JORNADA}T00:00:00Z`);
    for (let offset = -5; offset <= 40; offset += 1) {
      const venc = new Date(base + offset * 86_400_000);
      const e = derivarEstadoPartida({ cantidadDisponible: "1", fechaVencimiento: venc, fechaApertura: null }, CTX);
      const esperado = offset < 0 ? "VENCIDA" : offset <= 30 ? "POR_VENCER" : "VIGENTE";
      expect(e, `offset ${offset}`).toBe(esperado);
    }
  });
});

describe("derivarEstadoPartida -- the jornada comes from the tenant's zone, not the UTC calendar", () => {
  // 2026-10-01T02:00Z is still 2026-09-30 (23:00) in Mendoza (UTC-3).
  const ahora = instante("2026-10-01T02:00:00Z");

  it("the same partida is POR_VENCER on the tenant's jornada but would be VENCIDA on the UTC date", () => {
    const jornadaTenant = jornadaDe(ahora, "America/Argentina/Mendoza");
    const jornadaUtc = jornadaDe(ahora, "UTC");
    expect(jornadaTenant).toBe("2026-09-30");
    expect(jornadaUtc).toBe("2026-10-01");
    expect(estado("5", "2026-09-30", null, { jornada: jornadaTenant, diasAlerta: 30 })).toBe("POR_VENCER");
    expect(estado("5", "2026-09-30", null, { jornada: jornadaUtc, diasAlerta: 30 })).toBe("VENCIDA");
  });

  it("reads the date column in UTC, whatever the server zone", () => {
    expect(fechaCalendario(fecha("2026-09-30"))).toBe("2026-09-30");
  });
});

describe("sumarDiasAJornada / parseDiasAlertaVencimiento", () => {
  it("adds calendar days across month, year and leap-day boundaries", () => {
    expect(sumarDiasAJornada("2026-10-01", 30)).toBe("2026-10-31");
    expect(sumarDiasAJornada("2026-12-25", 10)).toBe("2027-01-04");
    expect(sumarDiasAJornada("2028-02-28", 1)).toBe("2028-02-29");
    expect(sumarDiasAJornada("2026-10-01", 0)).toBe("2026-10-01");
  });

  it("parses the parametro like the stock alerts do: positive integer, else 30", () => {
    expect(parseDiasAlertaVencimiento("45")).toBe(45);
    expect(parseDiasAlertaVencimiento(null)).toBe(30);
    expect(parseDiasAlertaVencimiento(undefined)).toBe(30);
    expect(parseDiasAlertaVencimiento("0")).toBe(30);
    expect(parseDiasAlertaVencimiento("-5")).toBe(30);
    expect(parseDiasAlertaVencimiento("abc")).toBe(30);
  });
});

describe("correccionDeCosto -- only audit diffs that touch costoUnitario", () => {
  it("returns the old and new cost of a real correction", () => {
    expect(correccionDeCosto({ costoUnitario: "10.5" }, { costoUnitario: "12" })).toEqual({ costoAnterior: "10.5", costoNuevo: "12" });
  });

  it("accepts numeric JSON values and keeps plain (non-exponent) notation", () => {
    expect(correccionDeCosto({ costoUnitario: 10.5 }, { costoUnitario: 0.0000001 })).toEqual({ costoAnterior: "10.5", costoNuevo: "0.0000001" });
  });

  it("is null when the diff does not mention costoUnitario on either side", () => {
    expect(correccionDeCosto({ fechaApertura: null }, { fechaApertura: "2026-09-01" })).toBeNull();
    expect(correccionDeCosto(null, null)).toBeNull();
    expect(correccionDeCosto({}, {})).toBeNull();
    expect(correccionDeCosto("costoUnitario", ["costoUnitario"])).toBeNull();
  });

  it("a side that lacks the key or holds garbage comes back as null, but the row still counts", () => {
    expect(correccionDeCosto(null, { costoUnitario: "7" })).toEqual({ costoAnterior: null, costoNuevo: "7" });
    expect(correccionDeCosto({ costoUnitario: "no-numero" }, { costoUnitario: "7" })).toEqual({ costoAnterior: null, costoNuevo: "7" });
  });
});

describe("calcularPaginacion", () => {
  it("clamps into [1, totalPages] and an empty list still has one page", () => {
    expect(calcularPaginacion(0, 5)).toEqual({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
    expect(calcularPaginacion(23, 99)).toEqual({ page: 3, pageSize: 10, total: 23, totalPages: 3 });
    expect(calcularPaginacion(23, 0)).toMatchObject({ page: 1 });
    expect(calcularPaginacion(10, 1)).toMatchObject({ totalPages: 1 });
    expect(calcularPaginacion(11, 2)).toMatchObject({ page: 2, totalPages: 2 });
  });
});

// ----------------------------------------------------------------------------
// armarTrayectoriaProveedor
// ----------------------------------------------------------------------------

const ACCESO_TOTAL: AccesoTrayectoriaProveedor = { costos: true, preparaciones: true, contralor: true, correcciones: true, linkPartida: true };
const ACCESO_BASE: AccesoTrayectoriaProveedor = { costos: false, preparaciones: false, contralor: false, correcciones: false, linkPartida: false };

function partida(id: string, extra: Partial<PartidaCruda> = {}): PartidaCruda {
  return {
    id,
    drogaNombre: "Minoxidil",
    esControlada: false,
    unidadBaseId: "u-g",
    unidadBaseSimbolo: "g",
    lote: `L-${id}`,
    fechaIngreso: new Date("2026-09-20T15:00:00Z"),
    fechaVencimiento: fecha("2027-06-30"),
    fechaApertura: null,
    cantidadInicial: "500",
    cantidadDisponible: "320",
    costoUnitario: "12.5",
    ...extra,
  };
}

const mov = (id: string, partidaId: string, extra: Partial<MovimientoCrudo> = {}): MovimientoCrudo => ({
  id,
  partidaId,
  tipo: "EGRESO_PREPARACION",
  cantidad: "30",
  motivoAjuste: null,
  observacion: null,
  registradoEn: new Date("2026-09-25T15:00:00Z"),
  registradoPorId: "u1",
  autorizadoPorId: null,
  totalDePartida: 2,
  ...extra,
});

const prep = (id: string, partidaId: string, extra: Partial<PreparacionCruda> = {}): PreparacionCruda => ({
  partidaId,
  id,
  estado: "CONFIRMADA",
  iniciadaEn: new Date("2026-09-25T14:00:00Z"),
  confirmadaEn: new Date("2026-09-25T15:00:00Z"),
  descartadaEn: null,
  totalDePartida: 1,
  ...extra,
});

const audit = (id: string, partidaId: string, valorAnterior: unknown, valorNuevo: unknown): AuditoriaCostoCruda => ({
  id,
  partidaId,
  valorAnterior,
  valorNuevo,
  motivo: "Factura corregida",
  ocurridoEn: new Date("2026-09-28T15:00:00Z"),
  usuarioNombre: "Ana",
  usuarioApellido: "Gómez",
});

function cruda(extra: Partial<TrayectoriaProveedorCruda> = {}): TrayectoriaProveedorCruda {
  return {
    proveedor: { id: "pv1", razonSocial: "Droguería Sur", cuit: "20123456786", fechaBaja: null, motivoBaja: null },
    zonaHoraria: "America/Argentina/Mendoza",
    jornada: JORNADA,
    diasAlerta: 30,
    resumen: { partidas: 2, drogasDistintas: 1, ultimoIngreso: new Date("2026-09-20T15:00:00Z"), vencidasConSaldo: 0, porVencer: 1 },
    totales: { totalComprado: "12500.5", stockValorizado: "4000" },
    page: 1,
    partidas: [partida("p1"), partida("p2", { esControlada: true, cantidadDisponible: "0" })],
    movimientos: [mov("m1", "p1"), mov("m2", "p1", { tipo: "INGRESO_COMPRA", autorizadoPorId: "u2" }), mov("m3", "p2", { totalDePartida: 31 })],
    usuarios: [
      { id: "u1", nombre: "Juan", apellido: "Pérez" },
      { id: "u2", nombre: "Marta", apellido: "Ruiz" },
    ],
    preparaciones: [prep("pr1", "p1")],
    contralor: [{ partidaId: "p2", numeroValeAdquisicion: "V-77", numeroAsiento: "412" } satisfies ContralorCrudo],
    auditoria: [audit("a1", "p1", { costoUnitario: "10" }, { costoUnitario: "12.5" }), audit("a2", "p1", { fechaApertura: null }, { fechaApertura: "2026-09-01" })],
    ...extra,
  };
}

describe("armarTrayectoriaProveedor", () => {
  it("builds each partida with its derived estado, movements and names resolved", () => {
    const t = armarTrayectoriaProveedor(cruda(), ACCESO_TOTAL);
    expect(t.partidas.map((p) => [p.id, p.estado])).toEqual([
      ["p1", "VIGENTE"],
      ["p2", "AGOTADA"],
    ]);
    const p1 = t.partidas[0]!;
    expect(p1.movimientos.items.map((m) => [m.id, m.registradoPor, m.autorizadoPor])).toEqual([
      ["m1", "Juan Pérez", null],
      ["m2", "Juan Pérez", "Marta Ruiz"],
    ]);
    expect(p1.movimientos).toMatchObject({ total: 2, hayMas: false });
  });

  it("reports the per-partida total so the UI can say 'mostrando N de M'", () => {
    const p2 = armarTrayectoriaProveedor(cruda(), ACCESO_TOTAL).partidas[1]!;
    expect(p2.movimientos).toMatchObject({ total: 31, hayMas: true });
    expect(p2.movimientos.items).toHaveLength(1);
  });

  it("a partida with no movements yields an empty, non-truncated list", () => {
    const t = armarTrayectoriaProveedor(cruda({ movimientos: [] }), ACCESO_TOTAL);
    expect(t.partidas[0]!.movimientos).toEqual({ items: [], total: 0, hayMas: false });
  });

  it("with every permiso: costs, preparaciones, contralor (controlled drogas only) and corrections", () => {
    const t = armarTrayectoriaProveedor(cruda(), ACCESO_TOTAL);
    const [p1, p2] = t.partidas as [(typeof t.partidas)[number], (typeof t.partidas)[number]];
    expect(t.resumen.totales).toEqual({ totalComprado: "12500.5", stockValorizado: "4000" });
    expect(p1.costoUnitario).toBe("12.5");
    expect(p1.preparaciones?.items.map((x) => x.id)).toEqual(["pr1"]);
    expect(p1.contralor).toBeNull(); // not a controlled droga
    expect(p2.contralor).toEqual({ numeroValeAdquisicion: "V-77", numeroAsiento: "412" });
    // only the audit row that touches costoUnitario survives
    expect(p1.correcciones).toHaveLength(1);
    expect(p1.correcciones![0]).toMatchObject({ id: "a1", costoAnterior: "10", costoNuevo: "12.5", motivo: "Factura corregida", quien: "Ana Gómez" });
  });

  it("without any optional permiso every optional block is null/absent, even if rows were handed in", () => {
    const t = armarTrayectoriaProveedor(cruda(), ACCESO_BASE);
    expect(t.resumen.totales).toBeNull();
    for (const p of t.partidas) {
      expect(p.costoUnitario).toBeNull();
      expect(p.preparaciones).toBeNull();
      expect(p.contralor).toBeNull();
      expect(p.correcciones).toBeNull();
    }
    // base data is still there
    expect(t.partidas[0]!.movimientos.items).toHaveLength(2);
    expect(t.resumen).toMatchObject({ partidas: 2, drogasDistintas: 1, porVencer: 1 });
  });

  it("auditoria.ver without stock.valorizado.ver shows THAT a cost was corrected, never the amounts", () => {
    const t = armarTrayectoriaProveedor(cruda(), { ...ACCESO_BASE, correcciones: true });
    expect(t.partidas[0]!.correcciones).toHaveLength(1);
    expect(t.partidas[0]!.correcciones![0]).toMatchObject({ costoAnterior: null, costoNuevo: null, quien: "Ana Gómez" });
  });

  it("a controlled partida with libro.ver but no asiento shows the vale and no asiento number", () => {
    const t = armarTrayectoriaProveedor(
      cruda({ contralor: [{ partidaId: "p2", numeroValeAdquisicion: null, numeroAsiento: null }] }),
      { ...ACCESO_BASE, contralor: true },
    );
    expect(t.partidas[1]!.contralor).toEqual({ numeroValeAdquisicion: null, numeroAsiento: null });
  });

  it("paginates over ALL the proveedor's partidas (the resumen count), clamping the page", () => {
    const t = armarTrayectoriaProveedor(cruda({ resumen: { partidas: 23, drogasDistintas: 3, ultimoIngreso: null, vencidasConSaldo: 0, porVencer: 0 }, page: 99 }), ACCESO_BASE);
    expect(t.paginacion).toEqual({ page: 3, pageSize: 10, total: 23, totalPages: 3 });
  });

  it("derives the estado with the jornada and window read by the repository", () => {
    const t = armarTrayectoriaProveedor(
      cruda({ jornada: "2026-09-30", diasAlerta: 7, partidas: [partida("p1", { fechaVencimiento: fecha("2026-09-30") }), partida("p2", { fechaVencimiento: fecha("2026-10-08") })] }),
      ACCESO_BASE,
    );
    expect(t.partidas.map((p) => p.estado)).toEqual(["POR_VENCER", "VIGENTE"]);
  });
});

// ----------------------------------------------------------------------------
// shared money formatters (shared/format/monto.ts)
// ----------------------------------------------------------------------------

describe("formatearMonto / formatearCostoUnitario", () => {
  it("formatearMonto: es-AR with two decimals", () => {
    expect(formatearMonto("1234.5")).toBe("1.234,50");
    expect(formatearMonto("12500.5")).toBe("12.500,50");
    expect(formatearMonto("0")).toBe("0,00");
    expect(formatearMonto("-1500")).toBe("-1.500,00");
    expect(formatearMonto("1234567.891")).toBe("1.234.567,89");
  });

  it("formatearCostoUnitario: at least two decimals, up to six, so a sub-cent cost never reads as 0,00", () => {
    expect(formatearCostoUnitario("12.5")).toBe("12,50");
    expect(formatearCostoUnitario("0.0035")).toBe("0,0035");
    expect(formatearCostoUnitario("0.0000004")).toBe("0,00");
    expect(formatearCostoUnitario("1234.123456789")).toBe("1.234,123457");
    expect(formatearCostoUnitario("0")).toBe("0,00");
  });
});
