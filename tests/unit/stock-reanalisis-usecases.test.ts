/**
 * Unit tests for `marcarPartidaVencida` and `registrarReanalisisPartida`
 * (docs/specs/reanalisis-partida.md, migration 0074).
 *
 * Covers:
 * - `marcarPartidaVencida`: M3 lock-before-read order; discounts the entire saldo via VENCIMIENTO ajuste;
 *   refused when not vencida, saldo 0, or stock is held by active reservas.
 * - `registrarReanalisisPartida`: domain rejections per `rechazoReanalisis`; audits inside the same transaction.
 * - wrong DT password: rate-limiting / lockout and failure audit path shared with ajuste co-firma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { CO_FIRMA_GENERIC_ERROR } from "@/modules/stock/application/verificar-co-firma-dt";

const {
  TENANT_ID,
  PARTIDA_ID,
  DROGA_ID,
  PROVEEDOR_ID,
  DT_ID,
  UNIDAD_BASE_ID,
  JORNADA,
  callOrder,
  auditRecordMock,
  withTenantTransactionMock,
  lockPartidaMock,
  getPartidaParaAccionMock,
  insertAjusteMock,
  insertReanalisisMock,
  getReservadoEnPreparacionMock,
  convertirUnidadMock,
  getUnidadesParaConversionMock,
  resolveDtCandidatoMock,
  esDtVigenteHoyMock,
  recordCoFirmaFailureMock,
  recordCoFirmaSuccessMock,
  verifyPasswordMock,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  const TENANT_ID = "11111111-1111-1111-1111-111111111111";
  const PARTIDA_ID = "22222222-2222-4222-a222-222222222222";
  const DROGA_ID = "33333333-3333-4333-a333-333333333333";
  const PROVEEDOR_ID = "44444444-4444-4444-a444-444444444444";
  const DT_ID = "55555555-5555-4555-a555-555555555555";
  const UNIDAD_BASE_ID = "77777777-7777-4777-a777-777777777777";
  const JORNADA = "2026-06-15";

  return {
    TENANT_ID,
    PARTIDA_ID,
    DROGA_ID,
    PROVEEDOR_ID,
    DT_ID,
    UNIDAD_BASE_ID,
    JORNADA,
    callOrder,
    auditRecordMock: vi.fn(async () => undefined),
    withTenantTransactionMock: vi.fn(
      async (tenantId: string, fn: (tx: unknown) => unknown) =>
        fn({ __fakeTx: true, tenantId }),
    ),
    lockPartidaMock: vi.fn(async () => {
      callOrder.push("lock");
      return true;
    }),
    getPartidaParaAccionMock: vi.fn(),
    insertAjusteMock: vi.fn(async () => ({ id: "mov-ajuste-1" })),
    insertReanalisisMock: vi.fn(async () => ({
      id: "rean-1",
      fechaVencimientoAnterior: "2026-05-01",
    })),
    getReservadoEnPreparacionMock: vi.fn(async () => ({
      cantidad: "0",
      recetas: [] as string[],
    })),
    convertirUnidadMock: vi.fn(async (_tx: unknown, val: string) => val),
    getUnidadesParaConversionMock: vi.fn(async () => {
      const unidad = {
        id: UNIDAD_BASE_ID,
        codigo: "GRAMO",
        simbolo: "g",
        tipoMagnitud: "MASA",
        factor: "1",
        fechaBaja: null,
      };
      return new Map([[UNIDAD_BASE_ID, unidad]]);
    }),
    resolveDtCandidatoMock: vi.fn(),
    esDtVigenteHoyMock: vi.fn(async () => true),
    recordCoFirmaFailureMock: vi.fn(async () => undefined),
    recordCoFirmaSuccessMock: vi.fn(async () => undefined),
    verifyPasswordMock: vi.fn(async () => true),
  };
});

vi.mock("@/shared/audit", () => ({
  record: auditRecordMock,
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) =>
    withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error(
      "requireSession() unexpectedly called -- inject a session via execute(input, { session })",
    );
  }),
  requireRecentReauth: vi.fn(),
}));

vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  lockPartidaParaAccion: lockPartidaMock,
  getPartidaParaAccion: getPartidaParaAccionMock,
  insertAjuste: insertAjusteMock,
  insertReanalisis: insertReanalisisMock,
  getReservadoEnPreparacion: getReservadoEnPreparacionMock,
  jornadaActualTenant: async () => JORNADA,
  convertirUnidad: convertirUnidadMock,
  getUnidadesParaConversion: getUnidadesParaConversionMock,
}));

vi.mock("@/modules/stock/infrastructure/co-firma-repository", () => ({
  resolveDtCandidato: resolveDtCandidatoMock,
  esDtVigenteHoy: esDtVigenteHoyMock,
  recordCoFirmaFailure: recordCoFirmaFailureMock,
  recordCoFirmaSuccess: recordCoFirmaSuccessMock,
}));

vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: verifyPasswordMock,
}));

function fakeDtSession(): AuthenticatedSession {
  return {
    usuario: { id: DT_ID, email: "dt@example.com", nombre: "Directora", apellido: "Tecnica" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(["stock.ajuste.autorizar", "stock.ajuste.registrar", "stock.ver"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const { marcarPartidaVencida } = await import("@/modules/stock/application/marcar-partida-vencida");
const { registrarReanalisisPartida } = await import("@/modules/stock/application/reanalizar-partida");

const partidaVencidaBase = {
  id: PARTIDA_ID,
  drogaId: DROGA_ID,
  drogaNombre: "Ibuprofeno",
  drogaClase: "DROGA",
  unidadBaseId: UNIDAD_BASE_ID,
  unidadBaseSimbolo: "g",
  proveedorId: PROVEEDOR_ID,
  proveedorRazonSocial: "Droguería Central",
  lote: "L-2025-01",
  costoUnitario: "15.00",
  cantidadInicial: "500",
  cantidadDisponible: "120",
  cantidadReservada: "0",
  fechaIngreso: new Date("2025-01-10"),
  fechaVencimiento: new Date("2026-05-01"),
  fechaVencimientoVigente: new Date("2026-05-01"), // past relative to JORNADA "2026-06-15"
  fechaApertura: null,
  potenciaDeclarada: null,
};

describe("marcarPartidaVencida", () => {
  beforeEach(() => {
    callOrder.length = 0;
    lockPartidaMock.mockClear();
    getPartidaParaAccionMock.mockReset().mockResolvedValue({ ...partidaVencidaBase });
    insertAjusteMock.mockClear();
    auditRecordMock.mockClear();
    getReservadoEnPreparacionMock.mockReset().mockResolvedValue({ cantidad: "0", recetas: [] });
    resolveDtCandidatoMock.mockReset().mockResolvedValue({
      usuarioId: DT_ID,
      passwordHash: "hash-correcto",
      estado: "ACTIVO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    esDtVigenteHoyMock.mockReset().mockResolvedValue(true);
    verifyPasswordMock.mockReset().mockResolvedValue(true);
  });

  it("locks the partida BEFORE reading its saldo and executes one VENCIMIENTO ajuste for the exact remaining saldo", async () => {
    getPartidaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return { ...partidaVencidaBase, cantidadDisponible: "85.5" };
    });

    const result = await marcarPartidaVencida(
      { partidaId: PARTIDA_ID, password: "password-dt" },
      { session: fakeDtSession() },
    );

    expect(result).toEqual({ id: "mov-ajuste-1" });
    // First lock-before-read is marcarPartidaVencida; second lock-before-read is registrarAjusteEnTx
    expect(callOrder).toEqual(["lock", "read", "lock", "read"]);
    expect(callOrder.slice(0, 2)).toEqual(["lock", "read"]);
    expect(insertAjusteMock).toHaveBeenCalledTimes(1);
    expect(insertAjusteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        partidaId: PARTIDA_ID,
        cantidad: "85.5",
        motivoAjuste: "VENCIMIENTO",
        registradoPorId: DT_ID,
        autorizadoPorId: DT_ID,
      }),
    );
  });

  it("passes optional observacion through to the ajuste", async () => {
    await marcarPartidaVencida(
      { partidaId: PARTIDA_ID, observacion: "Lote descartado por precipitado", password: "password-dt" },
      { session: fakeDtSession() },
    );

    expect(insertAjusteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ observacion: "Lote descartado por precipitado" }),
    );
  });

  it("refuses when the partida is NOT vencida (fechaVencimientoVigente >= jornadaActual)", async () => {
    getPartidaParaAccionMock.mockResolvedValue({
      ...partidaVencidaBase,
      fechaVencimientoVigente: new Date("2026-07-01"), // future
    });

    await expect(
      marcarPartidaVencida({ partidaId: PARTIDA_ID, password: "password-dt" }, { session: fakeDtSession() }),
    ).rejects.toThrow("La partida todavía no está vencida.");

    expect(insertAjusteMock).not.toHaveBeenCalled();
  });

  it("refuses when the partida has saldo 0", async () => {
    getPartidaParaAccionMock.mockResolvedValue({
      ...partidaVencidaBase,
      cantidadDisponible: "0",
    });

    await expect(
      marcarPartidaVencida({ partidaId: PARTIDA_ID, password: "password-dt" }, { session: fakeDtSession() }),
    ).rejects.toThrow("La partida ya no tiene saldo para descontar.");

    expect(insertAjusteMock).not.toHaveBeenCalled();
  });

  it("refuses when the droga is not classe DROGA (e.g. excipiente / material)", async () => {
    getPartidaParaAccionMock.mockResolvedValue({
      ...partidaVencidaBase,
      drogaClase: "EXCIPIENTE",
    });

    await expect(
      marcarPartidaVencida({ partidaId: PARTIDA_ID, password: "password-dt" }, { session: fakeDtSession() }),
    ).rejects.toThrow("Solo se marca como vencida una partida de droga");

    expect(insertAjusteMock).not.toHaveBeenCalled();
  });

  it("refuses when active preparaciones hold reservations on the stock (saldo is not free)", async () => {
    getReservadoEnPreparacionMock.mockResolvedValue({ cantidad: "50", recetas: ["101"] });

    await expect(
      marcarPartidaVencida({ partidaId: PARTIDA_ID, password: "password-dt" }, { session: fakeDtSession() }),
    ).rejects.toThrow(/reservados en preparación/);

    expect(insertAjusteMock).not.toHaveBeenCalled();
  });

  it("404s when the locked partida does not exist", async () => {
    lockPartidaMock.mockResolvedValueOnce(false);

    await expect(
      marcarPartidaVencida({ partidaId: PARTIDA_ID, password: "password-dt" }, { session: fakeDtSession() }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(getPartidaParaAccionMock).not.toHaveBeenCalled();
  });
});

describe("registrarReanalisisPartida", () => {
  beforeEach(() => {
    callOrder.length = 0;
    lockPartidaMock.mockClear();
    getPartidaParaAccionMock.mockReset().mockResolvedValue({ ...partidaVencidaBase });
    insertReanalisisMock.mockClear();
    auditRecordMock.mockClear();
    resolveDtCandidatoMock.mockReset().mockResolvedValue({
      usuarioId: DT_ID,
      passwordHash: "hash-correcto",
      estado: "ACTIVO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    esDtVigenteHoyMock.mockReset().mockResolvedValue(true);
    verifyPasswordMock.mockReset().mockResolvedValue(true);
  });

  it("locks the partida, inserts reanálisis, and audits inside the same transaction", async () => {
    getPartidaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return partidaVencidaBase;
    });

    const result = await registrarReanalisisPartida(
      {
        partidaId: PARTIDA_ID,
        fechaReanalisis: "2027-01-15",
        motivo: "Reanálisis semestral",
        respaldo: "Certificado QC-456",
        password: "password-dt",
      },
      { session: fakeDtSession() },
    );

    expect(result).toEqual({ id: "rean-1" });
    expect(callOrder).toEqual(["lock", "read"]);
    expect(insertReanalisisMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        partidaId: PARTIDA_ID,
        fechaReanalisis: "2027-01-15",
        motivo: "Reanálisis semestral",
        respaldo: "Certificado QC-456",
        registradoPorId: DT_ID,
      }),
    );

    // Audit inside the same transaction
    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        usuarioId: DT_ID,
        entidad: "reanalisis_partida",
        entidadId: "rean-1",
        accion: "CREAR",
        motivo: "Reanálisis semestral",
        valorAnterior: { fechaVencimientoVigente: "2026-05-01" },
        valorNuevo: expect.objectContaining({
          partidaId: PARTIDA_ID,
          fechaReanalisis: "2027-01-15",
          respaldo: "Certificado QC-456",
        }),
      }),
    );
  });

  it("rejects with ValidationError when fechaReanalisis is not strictly in the future", async () => {
    await expect(
      registrarReanalisisPartida(
        { partidaId: PARTIDA_ID, fechaReanalisis: JORNADA, password: "password-dt" },
        { session: fakeDtSession() },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(insertReanalisisMock).not.toHaveBeenCalled();
  });

  it("rejects with DomainError when partida has saldo 0 (terminal state)", async () => {
    getPartidaParaAccionMock.mockResolvedValue({
      ...partidaVencidaBase,
      cantidadDisponible: "0",
    });

    await expect(
      registrarReanalisisPartida(
        { partidaId: PARTIDA_ID, fechaReanalisis: "2027-01-01", password: "password-dt" },
        { session: fakeDtSession() },
      ),
    ).rejects.toBeInstanceOf(DomainError);

    expect(insertReanalisisMock).not.toHaveBeenCalled();
  });

  it("rejects with DomainError when droga is not classe DROGA", async () => {
    getPartidaParaAccionMock.mockResolvedValue({
      ...partidaVencidaBase,
      drogaClase: "EXCIPIENTE",
    });

    await expect(
      registrarReanalisisPartida(
        { partidaId: PARTIDA_ID, fechaReanalisis: "2027-01-01", password: "password-dt" },
        { session: fakeDtSession() },
      ),
    ).rejects.toBeInstanceOf(DomainError);

    expect(insertReanalisisMock).not.toHaveBeenCalled();
  });

  it("rejects when the session DT is not vigente today during password verification", async () => {
    esDtVigenteHoyMock.mockResolvedValue(false);

    await expect(
      registrarReanalisisPartida(
        { partidaId: PARTIDA_ID, fechaReanalisis: "2027-01-01", password: "password-dt" },
        { session: fakeDtSession() },
      ),
    ).rejects.toThrow(CO_FIRMA_GENERIC_ERROR);

    expect(insertReanalisisMock).not.toHaveBeenCalled();
  });

  it("rejects with defense-in-depth check if DT was vigente during password check but ceases before write", async () => {
    // Password check succeeds (vigente = true), but internal command check fails (vigente = false)
    esDtVigenteHoyMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(
      registrarReanalisisPartida(
        { partidaId: PARTIDA_ID, fechaReanalisis: "2027-01-01", password: "password-dt" },
        { session: fakeDtSession() },
      ),
    ).rejects.toThrow("Solo el Director Técnico vigente (titular o suplente) puede registrar un reanálisis.");

    expect(insertReanalisisMock).not.toHaveBeenCalled();
  });
});

describe("wrong DT password lockout and audit path", () => {
  beforeEach(() => {
    lockPartidaMock.mockClear();
    insertAjusteMock.mockClear();
    insertReanalisisMock.mockClear();
    recordCoFirmaFailureMock.mockClear();
    recordCoFirmaSuccessMock.mockClear();
    resolveDtCandidatoMock.mockReset().mockResolvedValue({
      usuarioId: DT_ID,
      passwordHash: "hash-correcto",
      estado: "ACTIVO",
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
    esDtVigenteHoyMock.mockReset().mockResolvedValue(true);
    verifyPasswordMock.mockReset().mockResolvedValue(false); // wrong password
  });

  it("marcarPartidaVencida: rejects on wrong password without locking partida, increments attempts", async () => {
    let caught: unknown;
    try {
      await marcarPartidaVencida(
        { partidaId: PARTIDA_ID, password: "wrong-password" },
        { session: fakeDtSession() },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).message).toBe(CO_FIRMA_GENERIC_ERROR);
    expect((caught as DomainError).fields).toEqual(["password"]);
    expect(lockPartidaMock).not.toHaveBeenCalled();
    expect(insertAjusteMock).not.toHaveBeenCalled();
    expect(recordCoFirmaFailureMock).toHaveBeenCalledWith(
      expect.anything(),
      DT_ID,
      { intentosFallidos: 1, bloqueadoHasta: null },
    );
  });

  it("registrarReanalisisPartida: rejects on wrong password without locking partida, increments attempts", async () => {
    let caught: unknown;
    try {
      await registrarReanalisisPartida(
        { partidaId: PARTIDA_ID, fechaReanalisis: "2027-01-01", password: "wrong-password" },
        { session: fakeDtSession() },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).message).toBe(CO_FIRMA_GENERIC_ERROR);
    expect((caught as DomainError).fields).toEqual(["password"]);
    expect(lockPartidaMock).not.toHaveBeenCalled();
    expect(insertReanalisisMock).not.toHaveBeenCalled();
    expect(recordCoFirmaFailureMock).toHaveBeenCalledWith(
      expect.anything(),
      DT_ID,
      { intentosFallidos: 1, bloqueadoHasta: null },
    );
  });

  it("triggers lockout when failed attempts reach threshold (4 -> 5)", async () => {
    resolveDtCandidatoMock.mockResolvedValue({
      usuarioId: DT_ID,
      passwordHash: "hash-correcto",
      estado: "ACTIVO",
      intentosFallidos: 4,
      bloqueadoHasta: null,
    });

    await expect(
      marcarPartidaVencida(
        { partidaId: PARTIDA_ID, password: "wrong-password" },
        { session: fakeDtSession() },
      ),
    ).rejects.toBeInstanceOf(DomainError);

    expect(recordCoFirmaFailureMock).toHaveBeenCalledWith(
      expect.anything(),
      DT_ID,
      expect.objectContaining({
        intentosFallidos: 5,
        bloqueadoHasta: expect.any(Date),
      }),
    );
  });
});
