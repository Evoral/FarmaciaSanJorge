/**
 * Unit tests for `elaborarLoteCommand` and `datosParaElaborarQuery`
 * (openspec/changes/lotes-elaborados, EL1-EL8).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError } from "@/shared/errors";
import { MENSAJE_CONTRALOR_ELABORACION } from "@/modules/stock/domain/elaboracion-lote";
import type { FormulaLeida } from "@/modules/drogas/infrastructure/formula-repository";

const {
  TENANT_ID,
  USUARIO_ID,
  JORNADA,
  callOrder,
  auditRecordMock,
  withTenantTransactionMock,
  getDrogaProducidaMock,
  lockPartidasParaElaborarMock,
  getPartidasParaElaborarMock,
  listPartidasElegiblesParaElaborarMock,
  insertLoteElaboradoMock,
  contarLotesConPrefijoMock,
  lockNumeracionLotesElaboradosMock,
  existePartidaLoteMock,
  getFechaActivacionContralorMock,
  jornadaActualTenantMock,
  formulasDeDrogasEnTxMock,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  const TENANT_ID = "11111111-1111-4111-8111-111111111111";
  const USUARIO_ID = "99999999-9999-4999-8999-999999999999";
  const JORNADA = "2026-10-29";

  return {
    TENANT_ID,
    USUARIO_ID,
    JORNADA,
    callOrder,
    auditRecordMock: vi.fn(async () => undefined),
    withTenantTransactionMock: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({ __fakeTx: true, tenantId: TENANT_ID }),
    ),
    getDrogaProducidaMock: vi.fn(),
    lockPartidasParaElaborarMock: vi.fn(),
    getPartidasParaElaborarMock: vi.fn(),
    listPartidasElegiblesParaElaborarMock: vi.fn(),
    insertLoteElaboradoMock: vi.fn(),
    contarLotesConPrefijoMock: vi.fn(),
    lockNumeracionLotesElaboradosMock: vi.fn(async () => undefined),
    existePartidaLoteMock: vi.fn(),
    getFechaActivacionContralorMock: vi.fn(),
    jornadaActualTenantMock: vi.fn(),
    formulasDeDrogasEnTxMock: vi.fn(),
  };
});

vi.mock("@/shared/audit", () => ({
  record: auditRecordMock,
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/modules/drogas/application/formula-de-droga", () => ({
  formulasDeDrogasEnTx: formulasDeDrogasEnTxMock,
}));

vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  existePartidaLote: existePartidaLoteMock,
  getFechaActivacionContralor: getFechaActivacionContralorMock,
  jornadaActualTenant: jornadaActualTenantMock,
}));

vi.mock("@/modules/stock/infrastructure/elaboracion-lote-repository", () => ({
  getDrogaProducida: getDrogaProducidaMock,
  lockPartidasParaElaborar: lockPartidasParaElaborarMock,
  getPartidasParaElaborar: getPartidasParaElaborarMock,
  listPartidasElegiblesParaElaborar: listPartidasElegiblesParaElaborarMock,
  insertLoteElaborado: insertLoteElaboradoMock,
  contarLotesConPrefijo: contarLotesConPrefijoMock,
  lockNumeracionLotesElaborados: lockNumeracionLotesElaboradosMock,
}));

const { elaborarLoteCommand } = await import("@/modules/stock/application/elaborar-lote");
const { datosParaElaborarQuery } = await import("@/modules/stock/application/datos-para-elaborar");

function fakeSession(permisos: string[] = ["stock.lote.elaborar"]): AuthenticatedSession {
  return {
    tenantId: TENANT_ID,
    usuario: { id: USUARIO_ID, nombre: "Operador", apellido: "Test", email: "op@test.com" },
    permisos: new Set(permisos),
  } as unknown as AuthenticatedSession;
}

const DROGA_X_ID = "22222222-2222-4222-8222-222222222222";
const LACTOSA_ID = "33333333-3333-4333-8333-333333333333";
const PARTIDA_X_ID = "44444444-4444-4444-8444-444444444444";
const PARTIDA_LAC_ID = "55555555-5555-4555-8555-555555555555";
const FORMULA_ID = "66666666-6666-4666-8666-666666666666";

describe("elaborarLoteCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;

    jornadaActualTenantMock.mockResolvedValue(JORNADA);
    getFechaActivacionContralorMock.mockResolvedValue(null);
    existePartidaLoteMock.mockResolvedValue(false);
    contarLotesConPrefijoMock.mockResolvedValue(0);
    formulasDeDrogasEnTxMock.mockResolvedValue(new Map());

    getDrogaProducidaMock.mockResolvedValue({
      id: DROGA_X_ID,
      nombre: "Droga X",
      unidadBaseSimbolo: "g",
      clase: "DROGA",
      tipoControl: "NINGUNO",
      deBaja: false,
    });

    lockPartidasParaElaborarMock.mockImplementation(async (_tx, _tenant, ids: string[]) => {
      callOrder.push("lock");
      return ids.map((id) => ({ id }));
    });

    getPartidasParaElaborarMock.mockImplementation(async () => {
      callOrder.push("read");
      return [
        {
          id: PARTIDA_X_ID,
          lote: "L-X",
          drogaId: DROGA_X_ID,
          drogaNombre: "Droga X",
          drogaTipoControl: "NINGUNO",
          cantidadDisponible: "100",
          costoUnitario: "1000",
          potenciaDeclarada: null,
          fechaVencimiento: "2027-06-01",
        },
        {
          id: PARTIDA_LAC_ID,
          lote: "L-LAC",
          drogaId: LACTOSA_ID,
          drogaNombre: "Lactosa",
          drogaTipoControl: "NINGUNO",
          cantidadDisponible: "500",
          costoUnitario: "10",
          potenciaDeclarada: null,
          fechaVencimiento: "2027-03-01",
        },
      ];
    });

    insertLoteElaboradoMock.mockResolvedValue({
      partidaId: "nueva-partida-id",
      elaboracionLoteId: "nueva-elab-id",
    });
  });

  it("locks before reading", async () => {
    await elaborarLoteCommand.execute(
      {
        tipo: "DILUCION",
        drogaProducidaId: DROGA_X_ID,
        cantidadProducida: "100",
        consumos: [
          { partidaId: PARTIDA_X_ID, cantidad: "1" },
          { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
        ],
      },
      { session: fakeSession() },
    );

    expect(callOrder).toEqual(["lock", "read"]);
    expect(lockPartidasParaElaborarMock).toHaveBeenCalled();
    expect(getPartidasParaElaborarMock).toHaveBeenCalled();
  });

  it("NotFound when the locked count differs", async () => {
    // Only 1 of 2 locked
    lockPartidasParaElaborarMock.mockResolvedValueOnce([{ id: PARTIDA_X_ID }]);

    await expect(
      elaborarLoteCommand.execute(
        {
          tipo: "DILUCION",
          drogaProducidaId: DROGA_X_ID,
          cantidadProducida: "100",
          consumos: [
            { partidaId: PARTIDA_X_ID, cantidad: "1" },
            { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
          ],
        },
        { session: fakeSession() },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("DILUCION + formulaId is refused, and so is a formulaId that is not the droga's", async () => {
    // 1. DILUCION with formulaId
    await expect(
      elaborarLoteCommand.execute(
        {
          tipo: "DILUCION",
          drogaProducidaId: DROGA_X_ID,
          formulaId: FORMULA_ID,
          cantidadProducida: "100",
          consumos: [
            { partidaId: PARTIDA_X_ID, cantidad: "1" },
            { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
          ],
        },
        { session: fakeSession() },
      ),
    ).rejects.toThrow(DomainError);

    // 2. FORMULA with formulaId not matching droga's formula
    formulasDeDrogasEnTxMock.mockResolvedValueOnce(
      new Map([
        [
          DROGA_X_ID,
          {
            id: "different-formula-id",
            drogaId: DROGA_X_ID,
            cantidadReferencia: "100",
            componentes: [],
          } as unknown as FormulaLeida,
        ],
      ]),
    );

    await expect(
      elaborarLoteCommand.execute(
        {
          tipo: "FORMULA",
          drogaProducidaId: DROGA_X_ID,
          formulaId: FORMULA_ID,
          cantidadProducida: "100",
          consumos: [
            { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
          ],
        },
        { session: fakeSession() },
      ),
    ).rejects.toThrow(DomainError);
  });

  it("refuses with MENSAJE_CONTRALOR_ELABORACION when the contralor is active and the produced or a consumed droga is controlled, and allows it when the contralor is off", async () => {
    // Contralor active + produced droga controlled
    getFechaActivacionContralorMock.mockResolvedValueOnce("2026-01-01");
    getDrogaProducidaMock.mockResolvedValueOnce({
      id: DROGA_X_ID,
      nombre: "Droga X",
      unidadBaseSimbolo: "g",
      clase: "DROGA",
      tipoControl: "PSICOTROPICO",
      deBaja: false,
    });

    await expect(
      elaborarLoteCommand.execute(
        {
          tipo: "DILUCION",
          drogaProducidaId: DROGA_X_ID,
          cantidadProducida: "100",
          consumos: [
            { partidaId: PARTIDA_X_ID, cantidad: "1" },
            { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
          ],
        },
        { session: fakeSession() },
      ),
    ).rejects.toThrow(MENSAJE_CONTRALOR_ELABORACION);

    // Contralor active + consumed droga controlled
    getFechaActivacionContralorMock.mockResolvedValueOnce("2026-01-01");
    getPartidasParaElaborarMock.mockResolvedValueOnce([
      {
        id: PARTIDA_X_ID,
        lote: "L-X",
        drogaId: DROGA_X_ID,
        drogaNombre: "Droga X",
        drogaTipoControl: "ESTUPEFACIENTE",
        cantidadDisponible: "100",
        costoUnitario: "1000",
        potenciaDeclarada: null,
        fechaVencimiento: "2027-06-01",
      },
      {
        id: PARTIDA_LAC_ID,
        lote: "L-LAC",
        drogaId: LACTOSA_ID,
        drogaNombre: "Lactosa",
        drogaTipoControl: "NINGUNO",
        cantidadDisponible: "500",
        costoUnitario: "10",
        potenciaDeclarada: null,
        fechaVencimiento: "2027-03-01",
      },
    ]);

    await expect(
      elaborarLoteCommand.execute(
        {
          tipo: "DILUCION",
          drogaProducidaId: DROGA_X_ID,
          cantidadProducida: "100",
          consumos: [
            { partidaId: PARTIDA_X_ID, cantidad: "1" },
            { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
          ],
        },
        { session: fakeSession() },
      ),
    ).rejects.toThrow(MENSAJE_CONTRALOR_ELABORACION);

    // Contralor OFF + controlled droga -> ALLOWED
    getFechaActivacionContralorMock.mockResolvedValueOnce(null);
    getDrogaProducidaMock.mockResolvedValueOnce({
      id: DROGA_X_ID,
      nombre: "Droga X",
      unidadBaseSimbolo: "g",
      clase: "DROGA",
      tipoControl: "PSICOTROPICO",
      deBaja: false,
    });

    const res = await elaborarLoteCommand.execute(
      {
        tipo: "DILUCION",
        drogaProducidaId: DROGA_X_ID,
        cantidadProducida: "100",
        consumos: [
          { partidaId: PARTIDA_X_ID, cantidad: "1" },
          { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
        ],
      },
      { session: fakeSession() },
    );
    expect(res.partidaId).toBe("nueva-partida-id");
  });

  it("EL9: the code is DIL-<jornada>-<next>, under the numbering lock, skipping one already taken", async () => {
    contarLotesConPrefijoMock.mockResolvedValueOnce(1);
    existePartidaLoteMock.mockResolvedValueOnce(true);

    await elaborarLoteCommand.execute(
      {
        tipo: "DILUCION",
        drogaProducidaId: DROGA_X_ID,
        cantidadProducida: "100",
        consumos: [
          { partidaId: PARTIDA_X_ID, cantidad: "1" },
          { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
        ],
      },
      { session: fakeSession() },
    );

    expect(lockNumeracionLotesElaboradosMock).toHaveBeenCalled();
    expect(contarLotesConPrefijoMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, "DIL-20261029-");
    expect(insertLoteElaboradoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lote: "DIL-20261029-3" }));
  });

  it("insertLoteElaborado receives the costo, potencia and default vencimiento from validarElaboracion", async () => {
    await elaborarLoteCommand.execute(
      {
        tipo: "DILUCION",
        drogaProducidaId: DROGA_X_ID,
        cantidadProducida: "100",
        consumos: [
          { partidaId: PARTIDA_X_ID, cantidad: "1" },
          { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
        ],
      },
      { session: fakeSession() },
    );

    expect(insertLoteElaboradoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        tipo: "DILUCION",
        drogaId: DROGA_X_ID,
        lote: "DIL-20261029-1",
        cantidadProducida: "100",
        costoUnitario: "19.9", // (1 * 1000 + 99 * 10) / 100
        potenciaDeclarada: "1", // 1 / 100 * 100
        fechaVencimiento: "2027-03-01", // earliest of 2027-06-01 and 2027-03-01
        usuarioId: USUARIO_ID,
      }),
    );
  });

  it("the audit holds the consumos", async () => {
    await elaborarLoteCommand.execute(
      {
        tipo: "DILUCION",
        drogaProducidaId: DROGA_X_ID,
        cantidadProducida: "100",
        consumos: [
          { partidaId: PARTIDA_X_ID, cantidad: "1" },
          { partidaId: PARTIDA_LAC_ID, cantidad: "99" },
        ],
      },
      { session: fakeSession() },
    );

    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entidad: "partida",
        entidadId: "nueva-partida-id",
        valorNuevo: expect.objectContaining({
          origen: "ELABORACION_PROPIA",
          consumos: [
            { droga: "Droga X", lote: "L-X", cantidad: "1" },
            { droga: "Lactosa", lote: "L-LAC", cantidad: "99" },
          ],
        }),
      }),
    );
  });
});

describe("datosParaElaborarQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jornadaActualTenantMock.mockResolvedValue(JORNADA);
    getFechaActivacionContralorMock.mockResolvedValue(null);
    contarLotesConPrefijoMock.mockResolvedValue(2);

    getDrogaProducidaMock.mockResolvedValue({
      id: DROGA_X_ID,
      nombre: "Droga X",
      unidadBaseSimbolo: "g",
      clase: "DROGA",
      tipoControl: "NINGUNO",
      deBaja: false,
    });

    formulasDeDrogasEnTxMock.mockResolvedValue(
      new Map([
        [
          DROGA_X_ID,
          {
            id: FORMULA_ID,
            drogaId: DROGA_X_ID,
            cantidadReferencia: "100",
            actualizadaEn: "2026-10-29T10:00:00Z",
            actualizadaPor: "Admin",
            componentes: [
              { drogaId: LACTOSA_ID, drogaNombre: "Lactosa", cantidad: "99", unidadBaseSimbolo: "g" },
            ],
          },
        ],
      ]),
    );

    listPartidasElegiblesParaElaborarMock.mockResolvedValue([
      {
        id: "p-lac-abierta",
        lote: "LAC-AB",
        drogaId: LACTOSA_ID,
        drogaNombre: "Lactosa",
        cantidadDisponible: "20",
        costoUnitario: "10",
        potenciaDeclarada: null,
        fechaVencimiento: "2027-06-01",
        fechaApertura: "2026-10-01T10:00:00Z",
      },
      {
        id: "p-lac-cerrada",
        lote: "LAC-CERR",
        drogaId: LACTOSA_ID,
        drogaNombre: "Lactosa",
        cantidadDisponible: "100",
        costoUnitario: "10",
        potenciaDeclarada: null,
        fechaVencimiento: "2027-01-01",
        fechaApertura: null,
      },
    ]);
  });

  it("drogaIds = produced droga + fórmula components + extras, without duplicates", async () => {
    const EXTRA_ID = "77777777-7777-4777-8777-777777777777";
    await datosParaElaborarQuery.execute(
      {
        drogaProducidaId: DROGA_X_ID,
        // Passing LACTOSA_ID (already in formula) and EXTRA_ID
        drogaIds: [LACTOSA_ID, EXTRA_ID, DROGA_X_ID],
      },
      { session: fakeSession() },
    );

    expect(listPartidasElegiblesParaElaborarMock).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      [DROGA_X_ID, LACTOSA_ID, EXTRA_ID],
    );
  });

  it("costoUnitario is null without stock.valorizado.ver", async () => {
    // without stock.valorizado.ver
    const sinValorizado = await datosParaElaborarQuery.execute(
      { drogaProducidaId: DROGA_X_ID, drogaIds: [] },
      { session: fakeSession(["stock.lote.elaborar"]) },
    );
    expect(sinValorizado.partidasPorDroga[LACTOSA_ID]![0]!.costoUnitario).toBeNull();

    // with stock.valorizado.ver
    const conValorizado = await datosParaElaborarQuery.execute(
      { drogaProducidaId: DROGA_X_ID, drogaIds: [] },
      { session: fakeSession(["stock.lote.elaborar", "stock.valorizado.ver"]) },
    );
    expect(conValorizado.partidasPorDroga[LACTOSA_ID]![0]!.costoUnitario).toBe("10");
  });

  it("each group is in consumption order (abiertas first)", async () => {
    const res = await datosParaElaborarQuery.execute(
      { drogaProducidaId: DROGA_X_ID, drogaIds: [] },
      { session: fakeSession() },
    );
    const partidasLac = res.partidasPorDroga[LACTOSA_ID]!;
    expect(partidasLac).toHaveLength(2);
    // LAC-AB is abierta, so it comes first despite LAC-CERR having earlier vencimiento
    expect(partidasLac[0]!.id).toBe("p-lac-abierta");
    expect(partidasLac[1]!.id).toBe("p-lac-cerrada");
  });

  it("proximoLote comes from each tipo's prefix count", async () => {
    contarLotesConPrefijoMock.mockResolvedValueOnce(3);

    const res = await datosParaElaborarQuery.execute(
      { drogaProducidaId: DROGA_X_ID, drogaIds: [] },
      { session: fakeSession() },
    );
    expect(res.proximoLote).toEqual({ DILUCION: "DIL-20261029-4", FORMULA: "ELA-20261029-3" });
  });

  it("contralorActivo is set", async () => {
    getFechaActivacionContralorMock.mockResolvedValueOnce("2026-01-01");

    const conContralor = await datosParaElaborarQuery.execute(
      { drogaProducidaId: DROGA_X_ID, drogaIds: [] },
      { session: fakeSession() },
    );
    expect(conContralor.contralorActivo).toBe(true);

    getFechaActivacionContralorMock.mockResolvedValueOnce(null);
    const sinContralor = await datosParaElaborarQuery.execute(
      { drogaProducidaId: DROGA_X_ID, drogaIds: [] },
      { session: fakeSession() },
    );
    expect(sinContralor.contralorActivo).toBe(false);
  });
});
