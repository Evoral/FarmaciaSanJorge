/**
 * Unit tests for `listPartidasQuery` / `listPartidas` stockDroga resolution
 * (commit e8674fd, modules/stock/application/list-partidas.ts).
 *
 * Verifies that:
 * - When input.drogaId is set, stockDroga returns getStockDeDroga(tx, tenantId, drogaId).
 * - When input.drogaId is omitted, stockDroga is null and getStockDeDroga is never called.
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import type { listPartidasHistorial } from "@/modules/stock/infrastructure/partida-repository";
import type { tiposElaboracionDePartidas } from "@/modules/stock/infrastructure/elaboracion-lote-repository";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) =>
  fn({ __fakeTx: true, tenantId }),
);
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

const SESSION: AuthenticatedSession = {
  usuario: { id: "u-stock", email: "stock@example.com", nombre: "Stock", apellido: "Tester" },
  tenantId: "11111111-1111-4111-8111-111111111111",
  sesionId: "ses-stock",
  permisos: new Set(["stock.ver"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => SESSION),
  requireRecentReauth: vi.fn(),
}));

const getStockDeDrogaMock = vi.fn<
  (_tx: unknown, _tenantId: string, _drogaId: string) => Promise<{ disponible: string; activo: string; unidadSimbolo: string } | null>
>(async () => ({
  disponible: "12.5",
  activo: "10.0",
  unidadSimbolo: "g",
}));

const listPartidasHistorialMock = vi.fn<typeof listPartidasHistorial>(async () => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  zonaHoraria: "America/Argentina/Buenos_Aires",
  droga: null,
  proveedores: [],
}));

vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  listPartidasHistorial: (...args: Parameters<typeof listPartidasHistorial>) => listPartidasHistorialMock(...args),
  jornadaActualTenant: vi.fn(async () => "2026-11-03"),
  getDiasAlertaVencimiento: vi.fn(async () => 30),
  getStockDeDroga: (...args: unknown[]) => getStockDeDrogaMock(...(args as [unknown, string, string])),
}));

const tiposElaboracionDePartidasMock = vi.fn<typeof tiposElaboracionDePartidas>(async () => new Map());
vi.mock("@/modules/stock/infrastructure/elaboracion-lote-repository", () => ({
  tiposElaboracionDePartidas: (...args: Parameters<typeof tiposElaboracionDePartidas>) => tiposElaboracionDePartidasMock(...args),
}));

const { listPartidasQuery } = await import("@/modules/stock/application/list-partidas");

describe("listPartidasQuery -- stockDroga (commit e8674fd)", () => {
  it("calls getStockDeDroga with tx, tenantId and drogaId when input.drogaId is set", async () => {
    getStockDeDrogaMock.mockClear();
    const drogaId = "22222222-2222-4222-8222-222222222222";
    const result = await listPartidasQuery.execute({ drogaId }, { session: SESSION });

    expect(getStockDeDrogaMock).toHaveBeenCalledTimes(1);
    expect(getStockDeDrogaMock).toHaveBeenCalledWith(
      expect.objectContaining({ __fakeTx: true, tenantId: SESSION.tenantId }),
      SESSION.tenantId,
      drogaId,
    );
    expect(result.stockDroga).toEqual({
      disponible: "12.5",
      activo: "10.0",
      unidadSimbolo: "g",
    });
  });

  it("returns stockDroga: null and does NOT call getStockDeDroga when input.drogaId is not provided", async () => {
    getStockDeDrogaMock.mockClear();
    const result = await listPartidasQuery.execute({}, { session: SESSION });

    expect(getStockDeDrogaMock).not.toHaveBeenCalled();
    expect(result.stockDroga).toBeNull();
  });

  it("returns stockDroga: null when getStockDeDroga returns null for a non-existent droga", async () => {
    getStockDeDrogaMock.mockResolvedValueOnce(null);
    const drogaId = "33333333-3333-4333-8333-333333333333";
    const result = await listPartidasQuery.execute({ drogaId }, { session: SESSION });

    expect(result.stockDroga).toBeNull();
  });
});
