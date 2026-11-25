import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
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

const leerHojaMock = vi.fn((..._args: unknown[]) => [] as unknown[][]);
vi.mock("@/shared/xlsx/validar-archivo-xlsx", () => ({
  validarArchivoXlsx: vi.fn(async () => ({ bytes: new Uint8Array([1]), nombreArchivo: "planilla.xlsx" })),
}));
vi.mock("@/shared/xlsx/leer-xlsx.server", () => ({
  leerLibroXlsx: vi.fn(async () => ({
    hojas: [{ nombre: "Hoja1" }],
    leerHoja: (...args: unknown[]) => leerHojaMock(...args),
  })),
}));

vi.mock("@/modules/stock/infrastructure/existencia-inicial-repository", () => ({
  lockTenantRelevamientoCompartido: vi.fn(async () => undefined),
  relevamientoInicialAbierto: vi.fn(async () => true),
}));

const createFilasRelevamientoMock = vi.fn(
  async (_tx: unknown, _filas: Array<{ lote: string | null; fechaVencimiento: Date | null }>) => undefined,
);
vi.mock("@/modules/stock/infrastructure/relevamiento-fila-repository", () => ({
  createFilasRelevamiento: (tx: unknown, filas: Array<{ lote: string | null; fechaVencimiento: Date | null }>) =>
    createFilasRelevamientoMock(tx, filas),
  listProveedoresActivos: vi.fn(async () => []),
  listUnidadesActivas: vi.fn(async () => [{ id: "u-g", codigo: "g", simbolo: "g", nombre: "Gramo" }]),
}));

vi.mock("@/modules/drogas/application/list-drogas-para-matching", () => ({
  listDrogasParaMatchingEnTx: vi.fn(async () => [
    { id: "d-1", nombre: "Paracetamol", nombreNormalizado: "paracetamol", seDosificaEnUi: false, sinonimos: [] },
    { id: "d-ui", nombre: "Vitamina D3", nombreNormalizado: "vitamina d3", seDosificaEnUi: true, sinonimos: [] },
  ]),
}));

const { importarPlanillaExcelCommand } = await import("@/modules/stock/application/importar-planilla-excel");

const SESSION: AuthenticatedSession = {
  usuario: { id: "u-1", email: "dt@example.com", nombre: "DT", apellido: "Test" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s-1",
  permisos: new Set(["stock.relevamiento.editar"] as Permiso[]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

beforeEach(() => {
  leerHojaMock.mockReset();
  createFilasRelevamientoMock.mockClear();
});

describe("importarPlanillaExcel -- lot vencimiento normalization", () => {
  it("accepts mm/aaaa and moves full dates (string and Date) to the end of the month", async () => {
    leerHojaMock.mockReturnValue([
      ["Droga", "Lote", "Vencimiento", "Cantidad", "Unidad"],
      ["Paracetamol", "L1", "03/2027", 10, "g"],
      ["Paracetamol", "L2", "15/02/2028", 10, "g"],
      ["Paracetamol", "L3", new Date("2026-04-10T00:00:00Z"), 10, "g"],
    ]);

    const res = await importarPlanillaExcelCommand.execute({ archivo: {} }, { session: SESSION });

    expect(res.filasImportadas).toBe(3);
    expect(res.noReconocidos).toEqual([]);
    const filas = createFilasRelevamientoMock.mock.calls[0]?.[1] as Array<{ lote: string; fechaVencimiento: Date | null }>;
    expect(filas).toHaveLength(3);
    expect(filas[0]!.fechaVencimiento?.toISOString().slice(0, 10)).toBe("2027-03-31");
    expect(filas[1]!.fechaVencimiento?.toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(filas[2]!.fechaVencimiento?.toISOString().slice(0, 10)).toBe("2026-04-30");
  });

  it("rejects invalid vencimiento strings in noReconocidos", async () => {
    leerHojaMock.mockReturnValue([
      ["Droga", "Lote", "Vencimiento", "Cantidad", "Unidad"],
      ["Paracetamol", "L1", "13/2027", 10, "g"],
    ]);

    const res = await importarPlanillaExcelCommand.execute({ archivo: {} }, { session: SESSION });

    expect(res.noReconocidos).toEqual([
      expect.objectContaining({
        fila: 2,
        columna: "Vencimiento",
        valor: "13/2027",
      }),
    ]);
  });

  it("refuses a se_dosifica_en_ui droga row when both Potencia and U.I./g are empty, and accepts either one", async () => {
    leerHojaMock.mockReturnValue([
      ["Droga", "Lote", "Vencimiento", "Cantidad", "Unidad", "Potencia", "U.I./g"],
      ["Vitamina D3", "L1", "12/2027", 10, "g", null, null],
      ["Vitamina D3", "L2", "12/2027", 10, "g", 100, null],
      ["Vitamina D3", "L3", "12/2027", 10, "g", null, "1000 U.I. cada 10 g"],
    ]);

    const res = await importarPlanillaExcelCommand.execute({ archivo: {} }, { session: SESSION });

    expect(res.filasImportadas).toBe(3);
    expect(res.noReconocidos).toEqual([
      expect.objectContaining({
        fila: 2,
        columna: "U.I./g",
        motivo: expect.stringContaining("se dosifica en U.I."),
      }),
    ]);
  });
});
