/**
 * Unit tests for the `factura` filter of `listPartidasQuery`
 * (modules/stock/application/list-partidas.ts): the typed text is trimmed,
 * capped at 40 characters and parsed by `parseBusquedaFactura` before it
 * reaches `listPartidasHistorial`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/shared/errors";
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

function filtroEnviado() {
  return listPartidasHistorialMock.mock.calls[0][1];
}

describe("listPartidasQuery -- factura filter", () => {
  beforeEach(() => listPartidasHistorialMock.mockClear());

  it("trims and parses the factura before passing it to the repository", async () => {
    await listPartidasQuery.execute({ factura: "  0001-00000123  " }, { session: SESSION });
    expect(filtroEnviado().factura).toEqual({ puntoVenta: "1", numero: "123" });
  });

  it("passes a lone number as the número only", async () => {
    await listPartidasQuery.execute({ factura: "00045" }, { session: SESSION });
    expect(filtroEnviado().factura).toEqual({ numero: "45" });
  });

  it("drops a factura without digits or an empty one", async () => {
    await listPartidasQuery.execute({ factura: "abc" }, { session: SESSION });
    expect(filtroEnviado().factura).toBeUndefined();
    listPartidasHistorialMock.mockClear();
    await listPartidasQuery.execute({ factura: "   " }, { session: SESSION });
    expect(filtroEnviado().factura).toBeUndefined();
  });

  it("rejects a factura longer than 40 characters", async () => {
    await expect(listPartidasQuery.execute({ factura: "1".repeat(41) }, { session: SESSION })).rejects.toBeInstanceOf(ValidationError);
    expect(listPartidasHistorialMock).not.toHaveBeenCalled();
  });
});
