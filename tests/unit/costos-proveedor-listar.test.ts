import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ValidationError } from "@/shared/errors";
import type { Permiso } from "@/modules/auth/domain/permisos";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId })),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called");
  }),
  requireRecentReauth: vi.fn(),
}));

const listCostosVigentesMock = vi.fn(async (..._args: unknown[]) => ({ items: [], total: 0, totalDesactualizados: 0 }));
const listListasPrecioMock = vi.fn(async (..._args: unknown[]) => ({ items: [], total: 0 }));
const listSinCostoMock = vi.fn(async (..._args: unknown[]) => ({ items: [], total: 0, page: 1, pageSize: 20 }));

vi.mock("@/modules/costos-proveedor/infrastructure/costo-proveedor-repository", () => ({
  getContextoTemporal: vi.fn(async () => ({ jornadaActual: "2026-11-18", zonaHoraria: "America/Argentina/Buenos_Aires" })),
  getAlicuotaIvaPorDefecto: vi.fn(async () => "21"),
  getDrogasParaCosto: vi.fn(async () => new Map()),
  getProveedorParaCosto: vi.fn(async () => null),
  listCostosVigentes: (...args: unknown[]) => listCostosVigentesMock(...args),
  listListasPrecio: (...args: unknown[]) => listListasPrecioMock(...args),
  listSinCosto: (...args: unknown[]) => listSinCostoMock(...args),
}));

const { listarCostosVigentesQuery } = await import("@/modules/costos-proveedor/application/listar-costos-vigentes");
const { listarListasPrecioQuery } = await import("@/modules/costos-proveedor/application/listar-listas-precio");
const { listarSinCostoQuery } = await import("@/modules/costos-proveedor/application/listar-sin-costo");

function sessionWith(permisos: Permiso[]): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "user@example.com", nombre: "U", apellido: "T" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s-1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

beforeEach(() => {
  listCostosVigentesMock.mockClear();
  listListasPrecioMock.mockClear();
  listSinCostoMock.mockClear();
});

describe("listarCostosVigentesQuery -- date, origen and soloDesactualizados parsing (39d36b9 + 0ccb991)", () => {
  const session = sessionWith(["stock.valorizado.ver", "costos.proveedor.gestionar"]);

  it("defaults origen to 'todos' (mapped to undefined) and soloDesactualizados to false, passing 1-year limiteDesactualizado", async () => {
    await listarCostosVigentesQuery.execute({}, { session });

    expect(listCostosVigentesMock).toHaveBeenCalledWith(
      expect.anything(),
      session.tenantId,
      expect.objectContaining({
        origen: undefined,
        soloDesactualizados: false,
        limiteDesactualizado: "2025-11-18",
      }),
    );
  });

  it("passes fechaDesde, fechaHasta, origen ('manual' | 'lista') and soloDesactualizados", async () => {
    await listarCostosVigentesQuery.execute(
      { fechaDesde: "2026-01-01", fechaHasta: "2026-06-30", origen: "lista", soloDesactualizados: true },
      { session },
    );

    expect(listCostosVigentesMock).toHaveBeenCalledWith(
      expect.anything(),
      session.tenantId,
      expect.objectContaining({
        fechaDesde: "2026-01-01",
        fechaHasta: "2026-06-30",
        origen: "lista",
        soloDesactualizados: true,
      }),
    );
  });

  it("rejects invalid fechaDesde, fechaHasta, or origen", async () => {
    await expect(listarCostosVigentesQuery.execute({ fechaDesde: "not-a-date" }, { session })).rejects.toBeInstanceOf(ValidationError);
    await expect(listarCostosVigentesQuery.execute({ fechaHasta: "2026-02-30" }, { session })).rejects.toBeInstanceOf(ValidationError);
    await expect(listarCostosVigentesQuery.execute({ origen: "otro" as never }, { session })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("listarListasPrecioQuery -- date filter parsing (39d36b9)", () => {
  const session = sessionWith(["stock.valorizado.ver"]);

  it("passes valid fechaDesde and fechaHasta and rejects invalid ISO dates", async () => {
    await listarListasPrecioQuery.execute({ fechaDesde: "2026-03-01", fechaHasta: "2026-03-31" }, { session });

    expect(listListasPrecioMock).toHaveBeenCalledWith(
      expect.anything(),
      session.tenantId,
      expect.objectContaining({ fechaDesde: "2026-03-01", fechaHasta: "2026-03-31" }),
    );

    await expect(listarListasPrecioQuery.execute({ fechaDesde: "2026/03/01" }, { session })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("listarSinCostoQuery -- tipo filter, search trimming and puedeGestionar (6035f54 + d0bcbeb)", () => {
  it("accepts todos, droga, excipiente and material, trims search, and reflects gestionar permission", async () => {
    const reader = sessionWith(["stock.valorizado.ver"]);
    const manager = sessionWith(["stock.valorizado.ver", "costos.proveedor.gestionar"]);

    const resReader = await listarSinCostoQuery.execute({ search: "  vaselina  ", tipo: "excipiente" }, { session: reader });
    expect(resReader.puedeGestionar).toBe(false);
    expect(listSinCostoMock).toHaveBeenCalledWith(
      expect.anything(),
      reader.tenantId,
      expect.objectContaining({ search: "vaselina", tipo: "excipiente", page: 1, pageSize: 20 }),
    );

    const resManager = await listarSinCostoQuery.execute({}, { session: manager });
    expect(resManager.puedeGestionar).toBe(true);
    expect(listSinCostoMock).toHaveBeenLastCalledWith(
      expect.anything(),
      manager.tenantId,
      expect.objectContaining({ tipo: "todos" }),
    );
  });

  it("rejects unsupported tipo values", async () => {
    const session = sessionWith(["stock.valorizado.ver"]);
    await expect(listarSinCostoQuery.execute({ tipo: "otro" as never }, { session })).rejects.toBeInstanceOf(ValidationError);
  });
});
