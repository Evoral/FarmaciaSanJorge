import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ValidationError } from "@/shared/errors";
import type { Permiso } from "@/modules/auth/domain/permisos";
import { parsearFacturaCompraPdf } from "@/modules/stock/domain/factura-compra-pdf-parser";

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

const insertComprobanteCompraMock = vi.fn(async (..._args: unknown[]) => ({ id: "comp-1" }));
vi.mock("@/modules/stock/infrastructure/factura-compra-repository", () => ({
  buscarComprobanteImportado: vi.fn(async () => null),
  insertComprobanteCompra: (...args: unknown[]) => insertComprobanteCompraMock(...args),
  getDrogaAlias: vi.fn(async () => null),
  insertDrogaAlias: vi.fn(async () => "alias-1"),
}));

vi.mock("@/modules/stock/application/ingresar-partida", () => ({
  registrarPartidaCompra: vi.fn(async () => ({ id: "part-1", valorNuevo: { droga: "Paracetamol" } })),
}));

const { importarFacturaCompraCommand } = await import("@/modules/stock/application/importar-factura-compra");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const PROVEEDOR_ID = "22222222-2222-4222-a222-222222222222";
const DROGA_ID = "33333333-3333-4333-a333-333333333333";
const UNIDAD_ID = "44444444-4444-4444-a444-444444444444";

const SESSION: AuthenticatedSession = {
  usuario: { id: "u-1", email: "far@example.com", nombre: "F", apellido: "T" },
  tenantId: TENANT_ID,
  sesionId: "s-1",
  permisos: new Set(["stock.partida.ingresar"] as Permiso[]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

function baseInput(numero: string) {
  return {
    origen: "manual" as const,
    proveedorId: PROVEEDOR_ID,
    letra: "A" as const,
    puntoVenta: "0001",
    numero,
    fechaEmision: "2026-06-15",
    lineas: [
      {
        drogaId: DROGA_ID,
        lote: "L1",
        fechaVencimiento: "2027-03",
        cantidadCompra: "10",
        unidadCompraId: UNIDAD_ID,
        precioUnitario: "100",
      },
    ],
    equivalencias: [],
  };
}

beforeEach(() => {
  insertComprobanteCompraMock.mockClear();
});

describe("importarFacturaCompra -- supplier numero acceptance (3255d2c)", () => {
  it("accepts non-digit supplier numbers up to 30 characters without stripping zeros", async () => {
    await importarFacturaCompraCommand.execute(baseInput("FA-0001-A/2026"), { session: SESSION });

    expect(insertComprobanteCompraMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ numero: "FA-0001-A/2026" }),
    );
  });

  it("strips leading zeros from all-digit numbers", async () => {
    await importarFacturaCompraCommand.execute(baseInput("000123456789"), { session: SESSION });

    expect(insertComprobanteCompraMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ numero: "123456789" }),
    );
  });

  it("rejects empty numero or numero longer than 30 characters", async () => {
    await expect(
      importarFacturaCompraCommand.execute(baseInput("   "), { session: SESSION }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      importarFacturaCompraCommand.execute(baseInput("X".repeat(31)), { session: SESSION }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("parsearFacturaCompraPdf -- mm/aaaa vencimiento and long numero (3255d2c)", () => {
  it("parses mm/aaaa and dd/mm/aaaa vencimientos to end-of-month and accepts >8 digit factura numbers", () => {
    const item = (str: string, x: number, y: number, width: number) => ({ str, x, y, width, height: 10 });
    const pdf = {
      links: [],
      pages: [
        [
          item("Factura:", 100, 50, 40),
          item("0001-0000012345", 160, 50, 80),
          item("Fecha:", 100, 70, 40),
          item("15/06/2026", 160, 70, 60),
          item("Descripción", 70, 100, 60),
          item("00369/010", 20, 120, 40),
          item("PARACETAMOL X 1", 70, 120, 120),
          item("kg", 200, 120, 20),
          item("10.000", 230, 120, 30),
          item("100.00", 270, 120, 30),
          item("1000.00", 310, 120, 40),
          item("Lote: L1 Vto: 03/2027", 70, 135, 150),
          item("00370/001", 20, 155, 40),
          item("CAFEINA X 1", 70, 155, 120),
          item("kg", 200, 155, 20),
          item("5.000", 230, 155, 30),
          item("200.00", 270, 155, 30),
          item("1000.00", 310, 155, 40),
          item("Lote: L2 Venc.: 15/02/2028", 70, 170, 150),
        ],
      ],
    };

    const res = parsearFacturaCompraPdf(pdf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.borrador.puntoVenta).toBe("1");
    expect(res.borrador.numero).toBe("12345");
    expect(res.borrador.items[0]?.lotes[0]?.fechaVencimiento).toBe("2027-03-31");
    expect(res.borrador.items[1]?.lotes[0]?.fechaVencimiento).toBe("2028-02-29");
  });
});
