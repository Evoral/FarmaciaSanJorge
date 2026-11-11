/**
 * `cargarAvisoIntegridad` (openspec/changes/incidentes-integridad-plataforma, D3-D4): the layout's integrity block.
 * The banner value is fixed before the registration runs, and nothing here may break the page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { redirect } from "next/navigation";
import type { AuthenticatedSession } from "@/shared/auth/session";

const resumenIntegridadConVerificacion = vi.fn();
vi.mock("@/modules/libro/application/resumen-integridad", () => ({
  resumenIntegridadConVerificacion: () => resumenIntegridadConVerificacion(),
}));

const registrarIncidentesIntegridad = vi.fn();
vi.mock("@/modules/libro/application/registrar-incidentes-integridad", () => ({
  registrarIncidentesIntegridad: (...args: unknown[]) => registrarIncidentesIntegridad(...args),
}));

const logger = { error: vi.fn(), warn: vi.fn() };
const getLoggerMock = vi.fn(() => logger);
vi.mock("@/shared/logging/logger", () => ({ getLogger: () => getLoggerMock() }));

const { cargarAvisoIntegridad } = await import("@/modules/libro/application/cargar-aviso-integridad");

const LIBRO = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const quebrados = [{ tipo: "RECETARIO" as const, primerQuiebreNumero: "3" }];
const verificacion = [{ libroId: LIBRO, tipo: "RECETARIO" as const, quiebre: "3" }];

function sessionWith(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: "11111111-1111-4111-a111-111111111111",
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

beforeEach(() => {
  resumenIntegridadConVerificacion.mockReset();
  registrarIncidentesIntegridad.mockReset();
  registrarIncidentesIntegridad.mockResolvedValue(undefined);
  logger.error.mockReset();
  getLoggerMock.mockReset();
  getLoggerMock.mockImplementation(() => logger);
});

describe("cargarAvisoIntegridad", () => {
  it("cache miss: returns the broken libros and registers the verification", async () => {
    resumenIntegridadConVerificacion.mockResolvedValue({ quebrados, verificacion });

    await expect(cargarAvisoIntegridad(sessionWith(["libro.ver"]))).resolves.toEqual(quebrados);
    expect(registrarIncidentesIntegridad).toHaveBeenCalledTimes(1);
    expect(registrarIncidentesIntegridad).toHaveBeenCalledWith(verificacion);
  });

  it("cache hit: returns the broken libros and does not register", async () => {
    resumenIntegridadConVerificacion.mockResolvedValue({ quebrados, verificacion: null });

    await expect(cargarAvisoIntegridad(sessionWith(["libro.ver"]))).resolves.toEqual(quebrados);
    expect(registrarIncidentesIntegridad).not.toHaveBeenCalled();
  });

  it("without libro.ver: no query and no registration", async () => {
    await expect(cargarAvisoIntegridad(sessionWith([]))).resolves.toEqual([]);
    expect(resumenIntegridadConVerificacion).not.toHaveBeenCalled();
    expect(registrarIncidentesIntegridad).not.toHaveBeenCalled();
  });

  it("registration throws: the banner value is intact", async () => {
    resumenIntegridadConVerificacion.mockResolvedValue({ quebrados, verificacion });
    registrarIncidentesIntegridad.mockRejectedValue(new Error("boom"));

    await expect(cargarAvisoIntegridad(sessionWith(["libro.ver"]))).resolves.toEqual(quebrados);
  });

  it("query throws: returns [], logs, and registers nothing", async () => {
    resumenIntegridadConVerificacion.mockRejectedValue(new Error("db down"));

    await expect(cargarAvisoIntegridad(sessionWith(["libro.ver"]))).resolves.toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(registrarIncidentesIntegridad).not.toHaveBeenCalled();
  });

  it("query throws and the logger is unavailable: still resolves []", async () => {
    resumenIntegridadConVerificacion.mockRejectedValue(new Error("db down"));
    getLoggerMock.mockImplementation(() => {
      throw new Error("logger env not configured");
    });

    await expect(cargarAvisoIntegridad(sessionWith(["libro.ver"]))).resolves.toEqual([]);
  });

  it("rethrows a Next control-flow error from the query", async () => {
    let nextError: unknown;
    try {
      redirect("/login");
    } catch (e) {
      nextError = e;
    }
    resumenIntegridadConVerificacion.mockRejectedValue(nextError);

    await expect(cargarAvisoIntegridad(sessionWith(["libro.ver"]))).rejects.toBe(nextError);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
