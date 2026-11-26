/**
 * Unit tests for `seDosificaEnUi` (openspec/specs/unidad-internacional/spec.md, UI2 / task 2.2):
 * crearDrogaCommand, editarDrogaCommand, and domain rules.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ValidationError } from "@/shared/errors";
import { seDosificaEnUiValida } from "@/modules/drogas/domain/droga";

const {
  TENANT_ID,
  USUARIO_ID,
  UNIDAD_MASA_ID,
  UNIDAD_VOLUMEN_ID,
  DROGA_ID,
  auditRecordMock,
  withTenantTransactionMock,
  insertDrogaMock,
  updateDrogaDatosMock,
  getDrogaParaAccionMock,
  lockDrogaParaAccionMock,
  existeNombreVigenteMock,
  tieneAlgunaPartidaMock,
  tienePartidaUiConStockMock,
  getEtiquetasUnidadesMock,
} = vi.hoisted(() => {
  const TENANT_ID = "11111111-1111-4111-8111-111111111111";
  const USUARIO_ID = "99999999-9999-4999-8999-999999999999";
  const UNIDAD_MASA_ID = "44444444-4444-4444-8444-444444444444";
  const UNIDAD_VOLUMEN_ID = "55555555-5555-4555-8555-555555555555";
  const DROGA_ID = "22222222-2222-4222-8222-222222222222";
  const unidadTipoMagnitud = new Map<string, string>([
    [UNIDAD_MASA_ID, "MASA"],
    [UNIDAD_VOLUMEN_ID, "VOLUMEN"],
  ]);

  return {
    TENANT_ID,
    USUARIO_ID,
    UNIDAD_MASA_ID,
    UNIDAD_VOLUMEN_ID,
    DROGA_ID,
    unidadTipoMagnitud,
    auditRecordMock: vi.fn(async () => undefined),
    withTenantTransactionMock: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({
        __fakeTx: true,
        tenantId: TENANT_ID,
        unidadMedida: {
          findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
            id: where.id,
            nombre: where.id === UNIDAD_VOLUMEN_ID ? "Mililitro" : "Gramo",
            simbolo: where.id === UNIDAD_VOLUMEN_ID ? "ml" : "g",
            tipoMagnitud: unidadTipoMagnitud.get(where.id) ?? "MASA",
            fechaBaja: null,
          })),
        },
      }),
    ),
    insertDrogaMock: vi.fn(),
    updateDrogaDatosMock: vi.fn(),
    getDrogaParaAccionMock: vi.fn(),
    lockDrogaParaAccionMock: vi.fn(),
    existeNombreVigenteMock: vi.fn(),
    tieneAlgunaPartidaMock: vi.fn(),
    tienePartidaUiConStockMock: vi.fn(),
    getEtiquetasUnidadesMock: vi.fn(),
  };
});

vi.mock("@/shared/audit", () => ({
  record: auditRecordMock,
  TipoAccion: {
    CREAR: "CREAR",
    MODIFICAR: "MODIFICAR",
    BAJA: "BAJA",
  },
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/modules/drogas/infrastructure/droga-repository", () => ({
  insertDroga: insertDrogaMock,
  updateDrogaDatos: updateDrogaDatosMock,
  getDrogaParaAccion: getDrogaParaAccionMock,
  lockDrogaParaAccion: lockDrogaParaAccionMock,
  existeNombreVigente: existeNombreVigenteMock,
  tieneAlgunaPartida: tieneAlgunaPartidaMock,
  tienePartidaUiConStock: tienePartidaUiConStockMock,
  getEtiquetasUnidades: getEtiquetasUnidadesMock,
}));

vi.mock("@/modules/libro/application/registrar-apertura-contralor", () => ({
  requiereAperturaContralorEnTx: vi.fn(async () => false),
  registrarAperturaContralorEnTx: vi.fn(),
}));

const { crearDrogaCommand } = await import("@/modules/drogas/application/crear-droga");
const { editarDrogaCommand } = await import("@/modules/drogas/application/editar-droga");

function fakeSession(): AuthenticatedSession {
  return {
    tenantId: TENANT_ID,
    usuario: { id: USUARIO_ID, nombre: "Admin", apellido: "Test", email: "admin@test.com" },
    permisos: new Set(["drogas.crear", "drogas.editar"]),
  } as unknown as AuthenticatedSession;
}

describe("drogas seDosificaEnUi (UI2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existeNombreVigenteMock.mockResolvedValue(null);
    insertDrogaMock.mockResolvedValue({ id: DROGA_ID });
    lockDrogaParaAccionMock.mockResolvedValue(true);
    updateDrogaDatosMock.mockResolvedValue(true);
    tieneAlgunaPartidaMock.mockResolvedValue(false);
    tienePartidaUiConStockMock.mockResolvedValue(false);
    getEtiquetasUnidadesMock.mockResolvedValue(new Map([[UNIDAD_MASA_ID, "Gramo (g)"]]));
  });

  it("domain: only clase DROGA can set seDosificaEnUi", () => {
    expect(seDosificaEnUiValida(true, "DROGA")).toBe(true);
    expect(seDosificaEnUiValida(true, "EXCIPIENTE")).toBe(false);
    expect(seDosificaEnUiValida(true, "MATERIAL")).toBe(false);
    expect(seDosificaEnUiValida(false, "EXCIPIENTE")).toBe(true);
  });

  it("crearDrogaCommand: creates a marked DROGA with MASA unit and records audit", async () => {
    await crearDrogaCommand.execute(
      {
        nombre: "Vitamina D3",
        unidadBaseId: UNIDAD_MASA_ID,
        clase: "DROGA",
        stockMinimo: "0",
        seDosificaEnUi: true,
      },
      { session: fakeSession() },
    );

    expect(insertDrogaMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ seDosificaEnUi: true }),
    );
    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entidad: "droga",
        valorNuevo: expect.objectContaining({ seDosificaEnUi: true }),
      }),
    );
  });

  it("crearDrogaCommand: rejects seDosificaEnUi on EXCIPIENTE with field errors", async () => {
    await expect(
      crearDrogaCommand.execute(
        {
          nombre: "Vaselina",
          unidadBaseId: UNIDAD_MASA_ID,
          clase: "EXCIPIENTE",
          stockMinimo: "0",
          seDosificaEnUi: true,
        },
        { session: fakeSession() },
      ),
    ).rejects.toMatchObject({
      constructor: ValidationError,
      fields: ["seDosificaEnUi", "clase"],
    });
    expect(insertDrogaMock).not.toHaveBeenCalled();
  });

  it("crearDrogaCommand: rejects seDosificaEnUi when unidadBase is not MASA", async () => {
    await expect(
      crearDrogaCommand.execute(
        {
          nombre: "Vitamina E líquida",
          unidadBaseId: UNIDAD_VOLUMEN_ID,
          clase: "DROGA",
          stockMinimo: "0",
          seDosificaEnUi: true,
        },
        { session: fakeSession() },
      ),
    ).rejects.toMatchObject({
      constructor: ValidationError,
      fields: ["seDosificaEnUi", "unidadBaseId"],
    });
    expect(insertDrogaMock).not.toHaveBeenCalled();
  });

  it("editarDrogaCommand: rejects unmarking seDosificaEnUi when a U.I. partida has stock", async () => {
    getDrogaParaAccionMock.mockResolvedValue({
      id: DROGA_ID,
      nombre: "Vitamina D3",
      unidadBaseId: UNIDAD_MASA_ID,
      densidad: null,
      esControlada: false,
      tipoControl: "NINGUNO",
      clase: "DROGA",
      stockMinimo: "0",
      sugerirDilucion: false,
      seDosificaEnUi: true,
      fechaBaja: null,
      motivoBaja: null,
    });
    tienePartidaUiConStockMock.mockResolvedValue(true);

    await expect(
      editarDrogaCommand.execute(
        {
          id: DROGA_ID,
          nombre: "Vitamina D3",
          stockMinimo: "0",
          seDosificaEnUi: false,
          version: {
            nombre: "Vitamina D3",
            unidadBaseId: UNIDAD_MASA_ID,
            esControlada: false,
            tipoControl: "NINGUNO",
            clase: "DROGA",
            stockMinimo: "0",
          },
        },
        { session: fakeSession() },
      ),
    ).rejects.toMatchObject({
      constructor: ValidationError,
      fields: ["seDosificaEnUi"],
    });
    expect(updateDrogaDatosMock).not.toHaveBeenCalled();
  });

  it("editarDrogaCommand: allows unmarking seDosificaEnUi when no U.I. partida has stock and audits old/new", async () => {
    getDrogaParaAccionMock.mockResolvedValue({
      id: DROGA_ID,
      nombre: "Vitamina D3",
      unidadBaseId: UNIDAD_MASA_ID,
      densidad: null,
      esControlada: false,
      tipoControl: "NINGUNO",
      clase: "DROGA",
      stockMinimo: "0",
      sugerirDilucion: false,
      seDosificaEnUi: true,
      fechaBaja: null,
      motivoBaja: null,
    });
    tienePartidaUiConStockMock.mockResolvedValue(false);

    await editarDrogaCommand.execute(
      {
        id: DROGA_ID,
        nombre: "Vitamina D3",
        stockMinimo: "0",
        seDosificaEnUi: false,
        version: {
          nombre: "Vitamina D3",
          unidadBaseId: UNIDAD_MASA_ID,
          esControlada: false,
          tipoControl: "NINGUNO",
          clase: "DROGA",
          stockMinimo: "0",
        },
      },
      { session: fakeSession() },
    );

    expect(updateDrogaDatosMock).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      expect.objectContaining({ seDosificaEnUi: false }),
      expect.anything(),
    );
    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        valorAnterior: expect.objectContaining({ seDosificaEnUi: true }),
        valorNuevo: expect.objectContaining({ seDosificaEnUi: false }),
      }),
    );
  });
});
