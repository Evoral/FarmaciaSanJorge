/**
 * Automatic ficha técnica + cotización after a receta is confirmed/edited
 * (docs/specs/presupuesto-receta.md): the orchestration
 * (application/generar-fichas-y-cotizaciones.ts, with the use cases it
 * calls mocked), the redirect notices (domain/avisos-generacion.ts), and
 * the "latest ficha still current" comparison that avoids a duplicate
 * version after an edit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { Decimal } from "@/shared/decimal";
import { FichaNoGenerableError, mismasLineasPesaje } from "@/modules/elaboracion/domain/ficha-no-generable";
import type { LineaPesajeCalculada } from "@/modules/elaboracion/domain/calcular-ficha-tecnica";

let sesion: AuthenticatedSession;
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => sesion),
  requireRecentReauth: vi.fn(),
}));
vi.mock("@/shared/logging/logger", () => ({ getLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

const getRecetaMock = vi.fn();
vi.mock("@/modules/recetas/application/get-receta", () => ({ getReceta: (...a: unknown[]) => getRecetaMock(...a) }));
const generarFichaMock = vi.fn();
vi.mock("@/modules/elaboracion/application/generar-ficha-tecnica", () => ({ generarFichaTecnica: (...a: unknown[]) => generarFichaMock(...a) }));
const cotizarMock = vi.fn();
vi.mock("@/modules/precios/application/calcular-cotizacion", () => ({ calcularCotizacionItem: (...a: unknown[]) => cotizarMock(...a) }));

const { generarFichasYCotizaciones } = await import("@/modules/recetas/application/generar-fichas-y-cotizaciones");
const { CotizacionNoCalculableError } = await import("@/modules/precios/application/cotizar-lineas");
const { codificarAvisos, decodificarAvisos, mensajeAviso } = await import("@/modules/recetas/domain/avisos-generacion");

function conPermisos(...permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

beforeEach(() => {
  sesion = conPermisos("fichas.generar", "cotizaciones.calcular");
  getRecetaMock.mockReset().mockResolvedValue({ id: "r1", items: [{ id: "i1" }, { id: "i2" }] });
  generarFichaMock.mockReset().mockResolvedValue({ id: "f", version: 1, generada: true, lineas: [] });
  cotizarMock.mockReset().mockResolvedValue({});
});

describe("generarFichasYCotizaciones", () => {
  it("generates a ficha and then a cotización for every item; nothing to report", async () => {
    expect(await generarFichasYCotizaciones("r1", { soloSiDesactualizadas: false })).toEqual([]);
    expect(generarFichaMock.mock.calls).toEqual([[{ itemRecetaId: "i1", soloSiDesactualizada: false }], [{ itemRecetaId: "i2", soloSiDesactualizada: false }]]);
    expect(cotizarMock.mock.calls).toEqual([[{ itemRecetaId: "i1" }], [{ itemRecetaId: "i2" }]]);
  });

  it("a failed ficha is reported with its code and skips that item's cotización; the rest goes on", async () => {
    generarFichaMock.mockRejectedValueOnce(new FichaNoGenerableError("V5", "..."));
    cotizarMock.mockRejectedValueOnce(new CotizacionNoCalculableError("SIN_REGLA_PRECIO", "..."));
    const avisos = await generarFichasYCotizaciones("r1", { soloSiDesactualizadas: false });
    expect(avisos).toEqual([
      { tipo: "ficha", item: 1, codigo: "V5" },
      { tipo: "cotizacion", item: 2, codigo: "SIN_REGLA_PRECIO" },
    ]);
    expect(cotizarMock.mock.calls).toEqual([[{ itemRecetaId: "i2" }]]);
  });

  it("an unexpected error becomes ERROR, never a throw", async () => {
    generarFichaMock.mockRejectedValue(new TypeError("boom"));
    expect(await generarFichasYCotizaciones("r1", { soloSiDesactualizadas: false })).toEqual([
      { tipo: "ficha", item: 1, codigo: "ERROR" },
      { tipo: "ficha", item: 2, codigo: "ERROR" },
    ]);
    getRecetaMock.mockRejectedValue(new Error("db down"));
    await expect(generarFichasYCotizaciones("r1", { soloSiDesactualizadas: false })).resolves.toEqual([]);
  });

  it("without fichas.generar nothing runs; without cotizaciones.calcular only the fichas do (silently)", async () => {
    sesion = conPermisos("cotizaciones.calcular");
    expect(await generarFichasYCotizaciones("r1", { soloSiDesactualizadas: false })).toEqual([]);
    expect(generarFichaMock).not.toHaveBeenCalled();

    sesion = conPermisos("fichas.generar");
    expect(await generarFichasYCotizaciones("r1", { soloSiDesactualizadas: false })).toEqual([]);
    expect(generarFichaMock).toHaveBeenCalledTimes(2);
    expect(cotizarMock).not.toHaveBeenCalled();
  });

  it("after an edit, an item whose ficha is still current keeps it and is not re-cotizado", async () => {
    generarFichaMock.mockResolvedValueOnce({ id: "f1", version: 3, generada: false, lineas: [] });
    await generarFichasYCotizaciones("r1", { soloSiDesactualizadas: true });
    expect(generarFichaMock).toHaveBeenCalledWith({ itemRecetaId: "i1", soloSiDesactualizada: true });
    expect(cotizarMock.mock.calls).toEqual([[{ itemRecetaId: "i2" }]]);
  });
});

describe("avisos de generación (redirect notice, codes only)", () => {
  it("round-trips through the query string", () => {
    const avisos = [
      { tipo: "ficha" as const, item: 1, codigo: "V5" as const },
      { tipo: "cotizacion" as const, item: 2, codigo: "SIN_REGLA_PRECIO" as const },
    ];
    const query = codificarAvisos(avisos);
    expect(query).toBe("?aviso=f1-V5&aviso=c2-SIN_REGLA_PRECIO");
    expect(decodificarAvisos(new URLSearchParams(query).getAll("aviso"), 2)).toEqual(avisos);
    expect(codificarAvisos([])).toBe("");
  });

  it("drops anything unknown, malformed or about an item the receta does not have", () => {
    expect(decodificarAvisos(["f3-V5", "f1-ALGO", "x1-V5", "f1-V5<script>", "c0-ERROR"], 2)).toEqual([]);
    expect(decodificarAvisos("f2-ERROR", 2)).toEqual([{ tipo: "ficha", item: 2, codigo: "ERROR" }]);
    expect(decodificarAvisos(undefined, 2)).toEqual([]);
  });

  it("rebuilds the Spanish message from the code", () => {
    expect(mensajeAviso({ tipo: "ficha", item: 1, codigo: "V8" })).toBe(
      "No se pudo generar la ficha técnica del ítem 1: La fracción de dosis por unidad debe ser mayor que 0 y menor o igual a 1. Podés generarla desde la receta.",
    );
    expect(mensajeAviso({ tipo: "cotizacion", item: 2, codigo: "SIN_REGLA_PRECIO" })).toBe(
      "No se pudo calcular la cotización del ítem 2: no hay regla de precios configurada. Podés calcularla desde la receta.",
    );
  });
});

describe("mismasLineasPesaje (edit -> regenerate only a stale ficha)", () => {
  const unidad = { id: "u-g", tipoMagnitud: "MASA" as const, factorABase: "1" };
  const calculada: LineaPesajeCalculada = {
    drogaId: "d1",
    drogaNombre: "Urea",
    cantidadTeorica: new Decimal("10"),
    excesoAplicado: new Decimal("0"),
    cantidadAPesar: new Decimal("10"),
    unidadMedida: unidad,
    esEnraseManual: false,
    orden: 0,
  };
  const guardada = { drogaId: "d1", cantidadTeorica: "10.000", excesoAplicado: "0", cantidadAPesar: "10", unidadMedidaId: "u-g", esEnraseManual: false, orden: 0 };

  it("same lines (decimals compared as numbers) -> current", () => {
    expect(mismasLineasPesaje([calculada], [guardada])).toBe(true);
  });

  it("a changed quantity, droga or line count -> stale", () => {
    expect(mismasLineasPesaje([calculada], [{ ...guardada, cantidadAPesar: "11" }])).toBe(false);
    expect(mismasLineasPesaje([calculada], [{ ...guardada, drogaId: "d2" }])).toBe(false);
    expect(mismasLineasPesaje([calculada], [])).toBe(false);
  });
});
