/**
 * Behavioral tests for "Reactivar" (docs/specs/retiro-vencido.md RV4-RV6) and the pop-up's data
 * (`getEntregaEstado` for a RETIRO_VENCIDO receta). Mocked repositories/tx, no DB. The stock module's co-firma
 * (`verificarCoFirmaDtEnTx`) runs for real on top of a mocked co-firma repository and password check, so what the
 * tests assert about a rejected co-firma (failed attempt counted, audited, nothing else written) is the real behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, InvariantViolationError, NotFoundError, ValidationError } from "@/shared/errors";
import { MENSAJE_REACTIVAR_ARCHIVADA, MENSAJE_REACTIVAR_NO_VENCIDA, MENSAJE_REACTIVAR_REQUIERE_CO_FIRMA } from "@/modules/entregas/domain/retiro-vencido";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

// `reactivarReceta` (the entry point the Server Action calls) takes no injected session: it resolves the current one.
const currentSession = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => currentSession.value),
  requireRecentReauth: vi.fn(),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

const resolveDtCandidatoMock = vi.fn();
const esDtVigenteHoyMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const recordCoFirmaFailureMock = vi.fn(async (...args: unknown[]) => {
  void args;
});
const recordCoFirmaSuccessMock = vi.fn(async (...args: unknown[]) => {
  void args;
});
const listDtVigentesParaCoFirmaMock = vi.fn();
vi.mock("@/modules/stock/infrastructure/co-firma-repository", () => ({
  resolveDtCandidato: (...args: unknown[]) => resolveDtCandidatoMock(...args),
  esDtVigenteHoy: (...args: unknown[]) => esDtVigenteHoyMock(...args),
  recordCoFirmaFailure: (...args: unknown[]) => recordCoFirmaFailureMock(...args),
  recordCoFirmaSuccess: (...args: unknown[]) => recordCoFirmaSuccessMock(...args),
  listDtVigentesParaCoFirma: (...args: unknown[]) => listDtVigentesParaCoFirmaMock(...args),
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const RECETA_ID = "22222222-2222-4222-a222-222222222222";
const DT_ID = "33333333-3333-4333-a333-333333333333";
const OPERADOR_ID = "u-operador";
const JORNADA = "2026-10-20";

function fakeSession(usuarioId = OPERADOR_ID): AuthenticatedSession {
  return {
    usuario: { id: usuarioId, email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(["entregas.registrar"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const callOrder: string[] = [];

const lockRecetaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("lock");
  return true;
});
const getRecetaParaEntregaMock = vi.fn();
const getRetiroVencidoDeRecetaMock = vi.fn();
const getPreparadosConVencimientoMock = vi.fn();
const jornadaActualTenantMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return JORNADA;
});
const actualizarEstadoRecetaMock = vi.fn(async (...args: unknown[]) => {
  callOrder.push(`estado:${String(args[3])}`);
});
const getDiasRetiroVencidoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return 30;
});
const zonaHorariaTenantMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return "America/Argentina/Mendoza";
});
const getItemsParaEntregaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return [{ id: "item-1", estadoAsiento: "VIGENTE" }];
});
const getEntregaPorRecetaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return null;
});
const hayRepartidoresActivosMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});

vi.mock("@/modules/entregas/infrastructure/entrega-repository", () => ({
  lockRecetaParaAccion: (...args: unknown[]) => lockRecetaMock(...args),
  getRecetaParaEntrega: (...args: unknown[]) => getRecetaParaEntregaMock(...args),
  getRetiroVencidoDeReceta: (...args: unknown[]) => getRetiroVencidoDeRecetaMock(...args),
  getPreparadosConVencimiento: (...args: unknown[]) => getPreparadosConVencimientoMock(...args),
  jornadaActualTenant: (...args: unknown[]) => jornadaActualTenantMock(...args),
  actualizarEstadoReceta: (...args: unknown[]) => actualizarEstadoRecetaMock(...args),
  getDiasRetiroVencido: (...args: unknown[]) => getDiasRetiroVencidoMock(...args),
  zonaHorariaTenant: (...args: unknown[]) => zonaHorariaTenantMock(...args),
  getItemsParaEntrega: (...args: unknown[]) => getItemsParaEntregaMock(...args),
  getEntregaPorReceta: (...args: unknown[]) => getEntregaPorRecetaMock(...args),
  getRepartidorDeEntrega: vi.fn(async () => null),
  hayRepartidoresActivos: (...args: unknown[]) => hayRepartidoresActivosMock(...args),
}));

const { reactivarRecetaCommand, reactivarReceta } = await import("@/modules/entregas/application/reactivar-receta");
const { getEntregaEstadoQuery } = await import("@/modules/entregas/application/get-entrega-estado");
const { CO_FIRMA_GENERIC_ERROR } = await import("@/modules/stock/application/verificar-co-firma-dt");
const { record: auditRecordMock } = await import("@/shared/audit");

const auditCalls = () => vi.mocked(auditRecordMock).mock.calls.map(([, entrada]) => entrada);
const recetaAudits = () => auditCalls().filter((entrada) => entrada.entidad === "receta");

const retiroVencido = { estado: "RETIRO_VENCIDO", pagada: false, domicilioPaciente: null, id: RECETA_ID };
const sinArchivar = { preparadaEn: new Date("2026-09-10T15:00:00Z"), loteArchivoId: null, loteNumero: null };
const vencido = { etiqueta: "Crema de prueba", fechaVencimiento: "2026-10-01" };
const vigente = { etiqueta: "Cápsulas de prueba", fechaVencimiento: "2027-03-01" };

function dtCandidato(overrides: Record<string, unknown> = {}) {
  return { usuarioId: DT_ID, passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null, ...overrides };
}

beforeEach(() => {
  currentSession.value = fakeSession();
  callOrder.length = 0;
  lockRecetaMock.mockClear();
  getRecetaParaEntregaMock.mockReset().mockResolvedValue(retiroVencido);
  getRetiroVencidoDeRecetaMock.mockReset().mockResolvedValue(sinArchivar);
  getPreparadosConVencimientoMock.mockReset().mockResolvedValue([vigente]);
  jornadaActualTenantMock.mockClear();
  actualizarEstadoRecetaMock.mockReset().mockImplementation(async (...args: unknown[]) => {
    callOrder.push(`estado:${String(args[3])}`);
  });
  getDiasRetiroVencidoMock.mockClear();
  vi.mocked(auditRecordMock).mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(true);
  resolveDtCandidatoMock.mockReset().mockResolvedValue(dtCandidato());
  esDtVigenteHoyMock.mockReset().mockResolvedValue(true);
  recordCoFirmaFailureMock.mockClear();
  recordCoFirmaSuccessMock.mockClear();
  listDtVigentesParaCoFirmaMock.mockReset().mockResolvedValue([]);
});

describe("reactivarReceta -- RV4: only a RETIRO_VENCIDO receta that is not archived", () => {
  it.each(["PREPARADA", "ENTREGADA", "ENVIADA_PEND_FIRMA", "ANULADA", "EN_PREPARACION"])("rejects a %s receta before reading its preparados", async (estado) => {
    getRecetaParaEntregaMock.mockResolvedValue({ ...retiroVencido, estado });

    const rejected = reactivarRecetaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession() });
    await expect(rejected).rejects.toBeInstanceOf(ValidationError);
    await expect(rejected).rejects.toThrow(MENSAJE_REACTIVAR_NO_VENCIDA);
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
    expect(getPreparadosConVencimientoMock).not.toHaveBeenCalled();
    expect(resolveDtCandidatoMock).not.toHaveBeenCalled();
    expect(auditCalls()).toEqual([]);
  });

  it("rejects an archived receta: nothing written, no co-firma attempted", async () => {
    getRetiroVencidoDeRecetaMock.mockResolvedValue({ ...sinArchivar, loteArchivoId: "lote-1", loteNumero: "7" });
    getPreparadosConVencimientoMock.mockResolvedValue([vencido]);

    const rejected = reactivarRecetaCommand.execute({ recetaId: RECETA_ID, dtUsuarioId: DT_ID, dtPassword: "x" }, { session: fakeSession() });
    await expect(rejected).rejects.toBeInstanceOf(ValidationError);
    await expect(rejected).rejects.toThrow(MENSAJE_REACTIVAR_ARCHIVADA);
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
    expect(resolveDtCandidatoMock).not.toHaveBeenCalled();
    expect(auditCalls()).toEqual([]);
  });

  it("404s when the receta does not exist (lock, or fresh read)", async () => {
    lockRecetaMock.mockImplementationOnce(async () => false);
    await expect(reactivarRecetaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession() })).rejects.toBeInstanceOf(NotFoundError);
    expect(getRecetaParaEntregaMock).not.toHaveBeenCalled();

    getRecetaParaEntregaMock.mockResolvedValue(null);
    await expect(reactivarRecetaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession() })).rejects.toBeInstanceOf(NotFoundError);
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
  });

  it("locks the receta first, exactly like registrarEntrega (same helper, before any read)", async () => {
    await reactivarRecetaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession() });

    expect(lockRecetaMock).toHaveBeenCalledWith({ __fakeTx: true, tenantId: TENANT_ID }, TENANT_ID, RECETA_ID);
    expect(lockRecetaMock.mock.invocationCallOrder[0]).toBeLessThan(getRecetaParaEntregaMock.mock.invocationCallOrder[0]!);
  });

  it("maps the INV-R08 backstop (archived in a race) to the archived message", async () => {
    actualizarEstadoRecetaMock.mockRejectedValue(new InvariantViolationError("INV-R08", "INV-R08: ..."));

    const rejected = reactivarRecetaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession() });
    await expect(rejected).rejects.toBeInstanceOf(DomainError);
    await expect(rejected).rejects.toThrow(MENSAJE_REACTIVAR_ARCHIVADA);
    expect(recetaAudits()).toEqual([]);
  });
});

describe("reactivarReceta -- no preparado vencido: reactivates without the co-firma", () => {
  it("moves the receta to PREPARADA and audits CAMBIAR_ESTADO a nombre del operador, with no DT", async () => {
    const result = await reactivarRecetaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession() });

    expect(result).toEqual({ ok: true, recetaId: RECETA_ID, autorizadoPorId: null });
    expect(callOrder).toEqual(["lock", "estado:PREPARADA"]);
    expect(actualizarEstadoRecetaMock).toHaveBeenCalledWith({ __fakeTx: true, tenantId: TENANT_ID }, TENANT_ID, RECETA_ID, "PREPARADA");
    expect(resolveDtCandidatoMock).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(1);
    const entrada = auditCalls()[0]!;
    expect(entrada).toMatchObject({
      tenantId: TENANT_ID,
      usuarioId: OPERADOR_ID,
      entidad: "receta",
      entidadId: RECETA_ID,
      accion: "CAMBIAR_ESTADO",
      valorAnterior: { estadoReceta: "RETIRO_VENCIDO" },
      valorNuevo: { estadoReceta: "PREPARADA" },
    });
    expect(entrada).not.toHaveProperty("autorizadoPorId");
    expect(entrada.valorNuevo).not.toHaveProperty("preparadosVencidos");
  });

  it("a preparado without fecha_vencimiento, or expiring today, does not ask for the co-firma", async () => {
    getPreparadosConVencimientoMock.mockResolvedValue([{ etiqueta: "Viejo", fechaVencimiento: null }, { etiqueta: "Hoy", fechaVencimiento: JORNADA }]);

    await reactivarRecetaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession() });
    expect(actualizarEstadoRecetaMock).toHaveBeenCalledOnce();
  });

  it("a co-firma sent anyway is neither verified nor recorded (the form only sends it when it is needed)", async () => {
    const result = await reactivarRecetaCommand.execute({ recetaId: RECETA_ID, dtUsuarioId: DT_ID, dtPassword: "x" }, { session: fakeSession() });

    expect(result).toMatchObject({ ok: true, autorizadoPorId: null });
    expect(resolveDtCandidatoMock).not.toHaveBeenCalled();
    expect(recetaAudits()[0]).not.toHaveProperty("autorizadoPorId");
  });
});

describe("reactivarReceta -- RV5/RV6: a preparado vencido needs the DT's co-firma", () => {
  beforeEach(() => {
    getPreparadosConVencimientoMock.mockResolvedValue([vigente, vencido]);
  });

  it("without any co-firma: field error on both fields, nothing written, no attempt made", async () => {
    const rejected = reactivarRecetaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession() });
    await expect(rejected).rejects.toBeInstanceOf(ValidationError);
    await expect(rejected).rejects.toThrow(MENSAJE_REACTIVAR_REQUIERE_CO_FIRMA);
    await expect(rejected).rejects.toMatchObject({ fields: ["dtUsuarioId", "dtPassword"] });
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
    expect(resolveDtCandidatoMock).not.toHaveBeenCalled();
    expect(auditCalls()).toEqual([]);
  });

  it("with the DT picked but no password: field error on the password only", async () => {
    await expect(reactivarRecetaCommand.execute({ recetaId: RECETA_ID, dtUsuarioId: DT_ID }, { session: fakeSession() })).rejects.toMatchObject({
      fields: ["dtPassword"],
    });
    expect(recordCoFirmaFailureMock).not.toHaveBeenCalled();
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
  });

  it("a wrong password: generic message on the password field, the failed attempt is counted and audited, nothing else is written", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    // The command COMMITS (a normal `ok: false` result), so the DT's counter and the rejection audit survive.
    const result = await reactivarRecetaCommand.execute({ recetaId: RECETA_ID, dtUsuarioId: DT_ID, dtPassword: "mala" }, { session: fakeSession() });
    expect(result).toEqual({ ok: false, message: CO_FIRMA_GENERIC_ERROR });
    expect(recordCoFirmaFailureMock).toHaveBeenCalledWith(expect.anything(), DT_ID, { intentosFallidos: 1, bloqueadoHasta: null });
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
    expect(recetaAudits()).toEqual([]);
    expect(auditCalls()).toEqual([expect.objectContaining({ entidad: "co_firma_dt", entidadId: DT_ID, accion: "AUTORIZAR", usuarioId: OPERADOR_ID })]);
  });

  it("the entry point turns a rejected co-firma into the one generic error, on the password field", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    const rejected = reactivarReceta({ recetaId: RECETA_ID, dtUsuarioId: DT_ID, dtPassword: "mala" });
    await expect(rejected).rejects.toBeInstanceOf(DomainError);
    await expect(rejected).rejects.toThrow(CO_FIRMA_GENERIC_ERROR);
    await expect(rejected).rejects.toMatchObject({ fields: ["dtPassword"] });
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
  });

  it("the entry point resolves with the receta once reactivated", async () => {
    await expect(reactivarReceta({ recetaId: RECETA_ID, dtUsuarioId: DT_ID, dtPassword: "buena" })).resolves.toEqual({ recetaId: RECETA_ID });
  });

  it("an unknown or not-vigente DT gets the same generic message (nothing about why)", async () => {
    resolveDtCandidatoMock.mockResolvedValue(null);
    const desconocido = await reactivarRecetaCommand.execute({ recetaId: RECETA_ID, dtUsuarioId: DT_ID, dtPassword: "x" }, { session: fakeSession() });
    expect(desconocido).toEqual({ ok: false, message: CO_FIRMA_GENERIC_ERROR });

    resolveDtCandidatoMock.mockResolvedValue(dtCandidato());
    esDtVigenteHoyMock.mockResolvedValue(false);
    const noVigente = await reactivarRecetaCommand.execute({ recetaId: RECETA_ID, dtUsuarioId: DT_ID, dtPassword: "x" }, { session: fakeSession() });
    expect(noVigente).toEqual({ ok: false, message: CO_FIRMA_GENERIC_ERROR });
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
  });

  it("a valid DT: reactivated, and the audit carries the DT and the vencidos only", async () => {
    const result = await reactivarRecetaCommand.execute({ recetaId: RECETA_ID, dtUsuarioId: DT_ID, dtPassword: "buena" }, { session: fakeSession() });

    expect(result).toEqual({ ok: true, recetaId: RECETA_ID, autorizadoPorId: DT_ID });
    expect(recordCoFirmaSuccessMock).toHaveBeenCalledWith(expect.anything(), DT_ID);
    // The estado is written only after the co-firma was accepted.
    expect(callOrder).toEqual(["lock", "estado:PREPARADA"]);
    expect(recetaAudits()).toHaveLength(1);
    expect(recetaAudits()[0]).toMatchObject({
      usuarioId: OPERADOR_ID,
      entidadId: RECETA_ID,
      accion: "CAMBIAR_ESTADO",
      autorizadoPorId: DT_ID,
      valorNuevo: { estadoReceta: "PREPARADA", preparadosVencidos: ["Crema de prueba (venció el 01/10/2026)"] },
    });
    // The password never reaches the audit.
    expect(JSON.stringify(auditCalls())).not.toContain("buena");
  });

  it("the operator may be the DT: they still type their own password (same verification)", async () => {
    resolveDtCandidatoMock.mockResolvedValue(dtCandidato({ usuarioId: OPERADOR_ID }));

    const result = await reactivarRecetaCommand.execute({ recetaId: RECETA_ID, dtUsuarioId: DT_ID, dtPassword: "buena" }, { session: fakeSession(OPERADOR_ID) });
    expect(result).toMatchObject({ ok: true, autorizadoPorId: OPERADOR_ID });
    expect(verifyPasswordMock).toHaveBeenCalledOnce();
  });
});

describe("getEntregaEstado -- what the pop-up shows for a RETIRO_VENCIDO receta", () => {
  const run = () => getEntregaEstadoQuery.execute({ recetaId: RECETA_ID }, { session: fakeSession() });

  it("is null for every other estado, without reading the retiro data", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ ...retiroVencido, estado: "PREPARADA" });

    const estado = await run();
    expect(estado.retiroVencido).toBeNull();
    expect(getRetiroVencidoDeRecetaMock).not.toHaveBeenCalled();
  });

  it("names the jornada the plazo expired (preparada_en + N), with no co-firma when nothing is vencido", async () => {
    const estado = await run();

    expect(estado.retiroVencido).toEqual({
      vencioEl: "2026-10-10",
      diasRetiroVencido: 30,
      archivada: false,
      loteNumero: null,
      preparadosVencidos: [],
      dts: [],
      operadorEsDt: false,
    });
    expect(listDtVigentesParaCoFirmaMock).not.toHaveBeenCalled();
  });

  it("lists the vencidos and the DT vigentes to pick from; knows when the operator is one of them", async () => {
    getPreparadosConVencimientoMock.mockResolvedValue([vencido, vigente]);
    listDtVigentesParaCoFirmaMock.mockResolvedValue([
      { usuarioId: DT_ID, nombre: "Ana", apellido: "Gómez" },
      { usuarioId: OPERADOR_ID, nombre: "Luis", apellido: "Ruiz" },
    ]);

    const estado = await run();
    expect(estado.retiroVencido).toMatchObject({
      preparadosVencidos: [vencido],
      dts: [
        { id: DT_ID, label: "Ana Gómez" },
        { id: OPERADOR_ID, label: "Luis Ruiz" },
      ],
      operadorEsDt: true,
    });
  });

  it("an archived receta: flagged with its lote, and nothing to co-sign", async () => {
    getRetiroVencidoDeRecetaMock.mockResolvedValue({ ...sinArchivar, loteArchivoId: "lote-1", loteNumero: "7" });
    getPreparadosConVencimientoMock.mockResolvedValue([vencido]);

    const estado = await run();
    expect(estado.retiroVencido).toMatchObject({ archivada: true, loteNumero: "7", preparadosVencidos: [], dts: [] });
    expect(getPreparadosConVencimientoMock).not.toHaveBeenCalled();
  });

  it("with the parameter at 0 there is no plazo to name", async () => {
    getDiasRetiroVencidoMock.mockResolvedValueOnce(0);

    expect((await run()).retiroVencido).toMatchObject({ vencioEl: null, diasRetiroVencido: 0 });
  });
});
