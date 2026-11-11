/**
 * Unit tests for `modules/stock/application/pasar-grupo-a-stock.ts`
 * (openspec/specs/existencia-inicial/spec.md R3, R15): a row's costo is typed
 * per the row's unit and stored per the droga's unidad base.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";
import type { AuthenticatedSession } from "@/shared/auth/session";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: { CREAR: "CREAR", MODIFICAR: "MODIFICAR", ELIMINAR: "ELIMINAR" },
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const DROGA_ID = "22222222-2222-4222-a222-222222222222";
const MG_ID = "44444444-4444-4444-a444-444444444444";
const G_ID = "66666666-6666-4666-a666-666666666666";
const KG_ID = "77777777-7777-4777-a777-777777777777";
const USUARIO_ID = "55555555-5555-4555-a555-555555555555";
const FILA_1 = "88888888-8888-4888-a888-888888888881";
const FILA_2 = "88888888-8888-4888-a888-888888888882";

const FACTOR_A_MG: Record<string, string> = { [MG_ID]: "1", [G_ID]: "1000", [KG_ID]: "1000000" };

function makeSession(): AuthenticatedSession {
  return {
    usuario: { id: USUARIO_ID, email: "far@example.com", nombre: "Nombre", apellido: "Apellido" },
    tenantId: TENANT_ID,
    sesionId: "s-1",
    permisos: new Set(["stock.partida.ingresar"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

function fila(id: string, cantidad: string, unidadId: string, costo: string | null) {
  return {
    id,
    droga_id: DROGA_ID,
    lote: "L-1",
    fecha_vencimiento: "2027-12-31",
    cantidad,
    unidad_medida_id: unidadId,
    potencia_declarada: null,
    costo_unitario: costo,
    proveedor_id: null,
  };
}

const lockFilasRelevamientoMock = vi.fn();
const findPartidaPorDrogaLoteProveedorMock = vi.fn(async (): Promise<unknown> => null);
vi.mock("@/modules/stock/infrastructure/relevamiento-fila-repository", () => ({
  lockFilasRelevamiento: lockFilasRelevamientoMock,
  deleteFilasRelevamiento: vi.fn(async () => undefined),
  findPartidaPorDrogaLoteProveedor: findPartidaPorDrogaLoteProveedorMock,
  getCostoVigenteSugerido: vi.fn(async () => null),
}));

vi.mock("@/modules/stock/infrastructure/existencia-inicial-repository", () => ({
  lockTenantRelevamientoCompartido: vi.fn(async () => undefined),
  relevamientoInicialAbierto: vi.fn(async () => true),
}));

vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  getDrogaParaIngreso: vi.fn(async () => ({
    id: DROGA_ID,
    nombre: "Droga Test",
    unidadBaseId: MG_ID,
    tipoControl: "NINGUNO",
    clase: "DROGA",
    fechaBaja: null,
  })),
  convertirUnidad: vi.fn(async (_tx: unknown, valor: string, origen: string, destino: string) =>
    new Decimal(valor).times(FACTOR_A_MG[origen]!).dividedBy(FACTOR_A_MG[destino]!).toString(),
  ),
  insertCorreccionInicialSuma: vi.fn(async () => undefined),
}));

const registrarPartidaCompraMock = vi.fn(async () => ({ id: "partida-1", valorNuevo: {} }));
vi.mock("@/modules/stock/application/ingresar-partida", () => ({
  registrarPartidaCompra: registrarPartidaCompraMock,
}));

const { pasarGrupoAStockCommand } = await import("@/modules/stock/application/pasar-grupo-a-stock");

describe("pasarGrupoAStock costo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findPartidaPorDrogaLoteProveedorMock.mockResolvedValue(null);
  });

  it("stores the price of a kg as the costo per mg of the partida", async () => {
    lockFilasRelevamientoMock.mockResolvedValueOnce([fila(FILA_1, "2", KG_ID, "50000")]);

    await pasarGrupoAStockCommand.execute({ filaIds: [FILA_1] }, { session: makeSession() });

    expect(registrarPartidaCompraMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cantidadCompra: "2000000", unidadCompraId: MG_ID, costo: { porUnidadBase: "0.05" } }),
    );
  });

  it("does not see a conflict between rows of the same price typed in kg and in g", async () => {
    lockFilasRelevamientoMock.mockResolvedValueOnce([
      fila(FILA_1, "1", KG_ID, "50000"),
      fila(FILA_2, "500", G_ID, "50"),
    ]);

    await pasarGrupoAStockCommand.execute({ filaIds: [FILA_1, FILA_2] }, { session: makeSession() });

    expect(registrarPartidaCompraMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cantidadCompra: "1500000", costo: { porUnidadBase: "0.05" } }),
    );
  });

  it("refuses a row whose converted costo differs from the partida in stock", async () => {
    lockFilasRelevamientoMock.mockResolvedValueOnce([fila(FILA_1, "1", KG_ID, "60000")]);
    findPartidaPorDrogaLoteProveedorMock.mockResolvedValueOnce({
      id: "partida-1",
      lote: "L-1",
      origen: "EXISTENCIA_INICIAL",
      fechaVencimiento: "2027-12-31",
      potenciaDeclarada: null,
      costoUnitario: "0.05",
    });

    await expect(
      pasarGrupoAStockCommand.execute({ filaIds: [FILA_1] }, { session: makeSession() }),
    ).rejects.toThrow(/costo unitario/);
    expect(registrarPartidaCompraMock).not.toHaveBeenCalled();
  });
});
