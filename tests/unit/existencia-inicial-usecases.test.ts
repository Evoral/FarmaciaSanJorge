/**
 * Unit tests for `modules/stock/application/ingresar-existencia-inicial.ts`
 * and `modules/stock/application/cerrar-relevamiento-inicial.ts`
 * (openspec/specs/existencia-inicial/spec.md R2-R8).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { MENSAJE_RELEVAMIENTO_CERRADO, type SaldoControlada } from "@/modules/stock/domain/existencia-inicial";

const auditRecordMock = vi.fn(async () => undefined);
vi.mock("@/shared/audit", () => ({
  record: auditRecordMock,
  TipoAccion: { CREAR: "CREAR", MODIFICAR: "MODIFICAR", ELIMINAR: "ELIMINAR" },
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) =>
  fn({ __fakeTx: true, tenantId }),
);
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (tenantId: string, fn: (tx: unknown) => unknown) => withTenantTransactionMock(tenantId, fn),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const DROGA_ID = "22222222-2222-4222-a222-222222222222";
const PROVEEDOR_ID = "33333333-3333-4333-a333-333333333333";
const UNIDAD_BASE_ID = "44444444-4444-4444-a444-444444444444";
const DT_USUARIO_ID = "55555555-5555-4555-a555-555555555555";

function makeSession(permisos: string[], usuarioId = DT_USUARIO_ID): AuthenticatedSession {
  return {
    usuario: { id: usuarioId, email: "dt@example.com", nombre: "Nombre", apellido: "Apellido" },
    tenantId: TENANT_ID,
    sesionId: "s-1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const callOrder: string[] = [];

const lockTenantRelevamientoCompartidoMock = vi.fn(async () => {
  callOrder.push("lockTenantRelevamientoCompartido");
});
const relevamientoInicialAbiertoMock = vi.fn(async () => {
  callOrder.push("relevamientoInicialAbierto");
  return true;
});
const lockTenantRelevamientoMock = vi.fn(async () => {
  callOrder.push("lockTenantRelevamiento");
});
const getEstadoRelevamientoInicialMock = vi.fn(async () => ({
  abierto: true,
  cerradoEn: null,
  cerradoPor: null,
  fechaLimite: "2026-07-15",
}));
const listSaldosControladasMock = vi.fn(async (): Promise<SaldoControlada[]> => []);
const contarExistenciaInicialPorDrogaMock = vi.fn(async () => [
  { drogaId: DROGA_ID, drogaNombre: "Droga Test", partidas: 2 },
]);
const updateCerrarRelevamientoMock = vi.fn(async () => new Date("2026-06-20T15:30:00Z"));

vi.mock("@/modules/stock/infrastructure/existencia-inicial-repository", () => ({
  lockTenantRelevamientoCompartido: lockTenantRelevamientoCompartidoMock,
  relevamientoInicialAbierto: relevamientoInicialAbiertoMock,
  lockTenantRelevamiento: lockTenantRelevamientoMock,
  getEstadoRelevamientoInicial: getEstadoRelevamientoInicialMock,
  listSaldosControladas: listSaldosControladasMock,
  contarExistenciaInicialPorDroga: contarExistenciaInicialPorDrogaMock,
  cerrarRelevamientoInicial: updateCerrarRelevamientoMock,
}));

const getDrogaParaIngresoMock = vi.fn(async () => ({
  id: DROGA_ID,
  nombre: "Droga Test",
  clase: "DROGA",
  unidadBaseId: UNIDAD_BASE_ID,
  tipoControl: "NINGUNO",
  fechaBaja: null,
  requiereCorreccionPotencia: false,
}));
const getProveedorParaIngresoMock = vi.fn(async () => ({
  id: PROVEEDOR_ID,
  razonSocial: "Proveedor Test",
  fechaBaja: null,
}));
const existePartidaLoteMock = vi.fn(async () => false);
const jornadaActualTenantMock = vi.fn(async () => "2026-06-15");
const getUnidadesParaConversionMock = vi.fn(async () =>
  new Map([[UNIDAD_BASE_ID, { id: UNIDAD_BASE_ID, codigo: "GRAMO", simbolo: "g", tipoMagnitud: "MASA", fechaBaja: null }]]),
);
const convertirUnidadMock = vi.fn(async (_tx: unknown, cant: string) => cant);
const getFechaActivacionContralorMock = vi.fn(async (): Promise<Date | null> => null);
const getEtiquetaUnidadMock = vi.fn(async () => "g");
const insertPartidaConIngresoMock = vi.fn(async () => ({ id: "p-nueva" }));

vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  getDrogaParaIngreso: getDrogaParaIngresoMock,
  getProveedorParaIngreso: getProveedorParaIngresoMock,
  existePartidaLote: existePartidaLoteMock,
  jornadaActualTenant: jornadaActualTenantMock,
  getUnidadesParaConversion: getUnidadesParaConversionMock,
  convertirUnidad: convertirUnidadMock,
  getFechaActivacionContralor: getFechaActivacionContralorMock,
  getEtiquetaUnidad: getEtiquetaUnidadMock,
  insertPartidaConIngreso: insertPartidaConIngresoMock,
}));

const esDtVigenteHoyMock = vi.fn(async () => true);
vi.mock("@/modules/stock/infrastructure/co-firma-repository", () => ({
  esDtVigenteHoy: esDtVigenteHoyMock,
}));

const verificarPasswordDtPartidaCommandMock = vi.fn(async () => ({ ok: true, message: "" }));
vi.mock("@/modules/stock/application/verificar-password-dt-partida", () => ({
  verificarPasswordDtPartidaCommand: {
    execute: verificarPasswordDtPartidaCommandMock,
  },
}));

const { ingresarExistenciaInicialCommand } = await import("@/modules/stock/application/ingresar-existencia-inicial");
const { cerrarRelevamientoInicial } = await import("@/modules/stock/application/cerrar-relevamiento-inicial");

describe("ingresarExistenciaInicialCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    relevamientoInicialAbiertoMock.mockImplementation(async () => {
      callOrder.push("relevamientoInicialAbierto");
      return true;
    });
    getFechaActivacionContralorMock.mockResolvedValue(null);
    getDrogaParaIngresoMock.mockResolvedValue({
      id: DROGA_ID,
      nombre: "Droga Test",
      clase: "DROGA",
      unidadBaseId: UNIDAD_BASE_ID,
      tipoControl: "NINGUNO",
      fechaBaja: null,
      requiereCorreccionPotencia: false,
    });
  });

  it("takes the tenant FOR SHARE lock (lockTenantRelevamientoCompartido) BEFORE checking relevamientoInicialAbierto", async () => {
    const session = makeSession(["stock.partida.ingresar"]);
    await ingresarExistenciaInicialCommand.execute(
      {
        drogaId: DROGA_ID,
        lote: "L-001",
        fechaVencimiento: "2027-01-01",
        cantidadCompra: "100",
        unidadCompraId: UNIDAD_BASE_ID,
        costoUnitario: "15.5",
      },
      { session },
    );

    expect(callOrder).toEqual(["lockTenantRelevamientoCompartido", "relevamientoInicialAbierto"]);
    expect(lockTenantRelevamientoCompartidoMock).toHaveBeenCalledTimes(1);
    expect(relevamientoInicialAbiertoMock).toHaveBeenCalledTimes(1);
    expect(insertPartidaConIngresoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        origen: "EXISTENCIA_INICIAL",
        proveedorId: null,
      }),
    );
  });

  it("is rejected with DomainError when the relevamiento inicial window is closed", async () => {
    relevamientoInicialAbiertoMock.mockImplementationOnce(async () => false);
    const session = makeSession(["stock.partida.ingresar"]);

    await expect(
      ingresarExistenciaInicialCommand.execute(
        {
          drogaId: DROGA_ID,
          lote: "L-001",
          fechaVencimiento: "2027-01-01",
          cantidadCompra: "100",
          unidadCompraId: UNIDAD_BASE_ID,
          costoUnitario: "15.5",
        },
        { session },
      ),
    ).rejects.toThrow(MENSAJE_RELEVAMIENTO_CERRADO);

    expect(insertPartidaConIngresoMock).not.toHaveBeenCalled();
  });

  it("succeeds without proveedor (proveedorId = null)", async () => {
    const session = makeSession(["stock.partida.ingresar"]);
    const res = await ingresarExistenciaInicialCommand.execute(
      {
        drogaId: DROGA_ID,
        lote: "L-SIN-PROV",
        fechaVencimiento: "2027-01-01",
        cantidadCompra: "50",
        unidadCompraId: UNIDAD_BASE_ID,
        costoUnitario: "20",
      },
      { session },
    );

    expect(res).toEqual({ id: "p-nueva" });
    expect(getProveedorParaIngresoMock).not.toHaveBeenCalled();
    expect(insertPartidaConIngresoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proveedorId: null,
        origen: "EXISTENCIA_INICIAL",
      }),
    );
  });

  it("succeeds with proveedor when provided", async () => {
    const session = makeSession(["stock.partida.ingresar"]);
    const res = await ingresarExistenciaInicialCommand.execute(
      {
        drogaId: DROGA_ID,
        proveedorId: PROVEEDOR_ID,
        lote: "L-CON-PROV",
        fechaVencimiento: "2027-01-01",
        cantidadCompra: "75",
        unidadCompraId: UNIDAD_BASE_ID,
        costoUnitario: "18",
      },
      { session },
    );

    expect(res).toEqual({ id: "p-nueva" });
    expect(getProveedorParaIngresoMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, PROVEEDOR_ID);
    expect(insertPartidaConIngresoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proveedorId: PROVEEDOR_ID,
        origen: "EXISTENCIA_INICIAL",
      }),
    );
  });

  it("does NOT require numeroValeAdquisicion even for a controlled droga with active contralor digital", async () => {
    // Controlled droga + contralor activo
    getDrogaParaIngresoMock.mockResolvedValueOnce({
      id: DROGA_ID,
      nombre: "Morfina",
      clase: "DROGA",
      unidadBaseId: UNIDAD_BASE_ID,
      tipoControl: "ESTUPEFACIENTE",
      fechaBaja: null,
      requiereCorreccionPotencia: false,
    });
    getFechaActivacionContralorMock.mockResolvedValueOnce(new Date("2026-01-01"));

    const session = makeSession(["stock.partida.ingresar"]);
    // input has no numeroValeAdquisicion
    const res = await ingresarExistenciaInicialCommand.execute(
      {
        drogaId: DROGA_ID,
        lote: "L-CTRL",
        fechaVencimiento: "2027-01-01",
        cantidadCompra: "10",
        unidadCompraId: UNIDAD_BASE_ID,
        costoUnitario: "100",
      },
      { session },
    );

    expect(res).toEqual({ id: "p-nueva" });
    expect(insertPartidaConIngresoMock).toHaveBeenCalled();
  });
});

describe("cerrarRelevamientoInicial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    verificarPasswordDtPartidaCommandMock.mockResolvedValue({ ok: true, message: "" });
    esDtVigenteHoyMock.mockResolvedValue(true);
    getEstadoRelevamientoInicialMock.mockResolvedValue({
      abierto: true,
      cerradoEn: null,
      cerradoPor: null,
      fechaLimite: "2026-07-15",
    });
    getFechaActivacionContralorMock.mockResolvedValue(null);
    listSaldosControladasMock.mockResolvedValue([]);
    contarExistenciaInicialPorDrogaMock.mockResolvedValue([
      { drogaId: DROGA_ID, drogaNombre: "Droga Test", partidas: 3 },
    ]);
  });

  it("rejects on wrong password before executing the close", async () => {
    verificarPasswordDtPartidaCommandMock.mockResolvedValueOnce({
      ok: false,
      message: "Contraseña incorrecta.",
    });
    const session = makeSession(["stock.ajuste.autorizar"]);

    await expect(
      cerrarRelevamientoInicial({ password: "wrong" }, { session }),
    ).rejects.toThrow("Contraseña incorrecta.");

    expect(lockTenantRelevamientoMock).not.toHaveBeenCalled();
    expect(updateCerrarRelevamientoMock).not.toHaveBeenCalled();
  });

  it("rejects when the caller is not the DT vigente today", async () => {
    esDtVigenteHoyMock.mockResolvedValueOnce(false);
    const session = makeSession(["stock.ajuste.autorizar"]);

    await expect(
      cerrarRelevamientoInicial({ password: "correct" }, { session }),
    ).rejects.toThrow("Solo el Director Técnico vigente (titular o suplente) puede cerrar el relevamiento inicial.");

    expect(updateCerrarRelevamientoMock).not.toHaveBeenCalled();
  });

  it("rejects when discrepancies between contralor and physical stock exist", async () => {
    getFechaActivacionContralorMock.mockResolvedValue(new Date("2026-01-01"));
    listSaldosControladasMock.mockResolvedValueOnce([
      {
        drogaId: DROGA_ID,
        drogaNombre: "Morfina Clorhidrato",
        unidadSimbolo: "g",
        saldoContralor: "5",
        stockFisico: "10",
      },
    ]);
    const session = makeSession(["stock.ajuste.autorizar"]);

    await expect(
      cerrarRelevamientoInicial({ password: "correct" }, { session }),
    ).rejects.toThrow(/No se puede cerrar: el libro contralor no coincide con el stock de Morfina Clorhidrato/);

    expect(updateCerrarRelevamientoMock).not.toHaveBeenCalled();
  });

  it("succeeds when valid, locks tenant FOR UPDATE, closes, and writes audit", async () => {
    const session = makeSession(["stock.ajuste.autorizar"]);
    const expectedDate = new Date("2026-06-20T15:30:00.000Z");
    updateCerrarRelevamientoMock.mockResolvedValueOnce(expectedDate);

    const result = await cerrarRelevamientoInicial({ password: "correct" }, { session });

    expect(result).toEqual({ cerradoEn: expectedDate });
    expect(lockTenantRelevamientoMock).toHaveBeenCalledTimes(1);
    expect(updateCerrarRelevamientoMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, DT_USUARIO_ID);

    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        usuarioId: DT_USUARIO_ID,
        entidad: "tenant",
        accion: "MODIFICAR",
        entidadId: TENANT_ID,
        valorAnterior: { relevamientoInicialCerradoEn: null },
        valorNuevo: {
          relevamientoInicialCerradoEn: expectedDate.toISOString(),
          drogas: 1,
          partidas: 3,
        },
      }),
    );
  });
});
