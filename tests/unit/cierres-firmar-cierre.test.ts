/**
 * Unit tests for `modules/cierres/application/firmar-cierre.ts` +
 * `verificar-password-firma.ts` (FASE 10, M13a point 10.1, user decision 6):
 * password verified BEFORE firming; PIN never accepted (structural: the
 * input schema has no `pin` field at all); a session without
 * `cierres.firmar` is rejected (authorization matrix, covered separately);
 * the client cannot inject `director_tecnico_id`/`designacion_id` -- both
 * are always resolved from the session/server, never from `FirmarCierreInput`
 * (which has no such fields to begin with).
 *
 * Mocks infra/session/transaction, same pattern as
 * tests/unit/libro-anular-asiento.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, ValidationError } from "@/shared/errors";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via firmarCierre(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
vi.mock("@/modules/auth/domain/password", () => ({ verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args) }));

const cargarUsuarioParaPasswordFirmaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return null as unknown;
});
const registrarFallaPasswordFirmaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const registrarExitoPasswordFirmaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const getDesignacionVigenteEnFechaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return null as unknown;
});
const firmarCierreDbMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return null as unknown;
});
const jornadaActualTenantMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return "2026-06-15";
});
const getPlazoFirmaDiasMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return 0;
});

vi.mock("@/modules/cierres/infrastructure/cierre-repository", () => ({
  cargarUsuarioParaPasswordFirma: (...args: unknown[]) => cargarUsuarioParaPasswordFirmaMock(...args),
  registrarFallaPasswordFirma: (...args: unknown[]) => registrarFallaPasswordFirmaMock(...args),
  registrarExitoPasswordFirma: (...args: unknown[]) => registrarExitoPasswordFirmaMock(...args),
  getDesignacionVigenteEnFecha: (...args: unknown[]) => getDesignacionVigenteEnFechaMock(...args),
  firmarCierreDb: (...args: unknown[]) => firmarCierreDbMock(...args),
  jornadaActualTenant: (...args: unknown[]) => jornadaActualTenantMock(...args),
  getPlazoFirmaDias: (...args: unknown[]) => getPlazoFirmaDiasMock(...args),
}));

const { firmarCierre } = await import("@/modules/cierres/application/firmar-cierre");
const { verificarPasswordFirmaCommand } = await import("@/modules/cierres/application/verificar-password-firma");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const DT_USUARIO_ID = "u-dt";
const OTHER_USUARIO_ID = "22222222-2222-4222-a222-222222222222";
const DESIGNACION_ID = "33333333-3333-4333-a333-333333333333";
const FECHA = "2026-06-15";

const dtSession: AuthenticatedSession = {
  usuario: { id: DT_USUARIO_ID, email: "dt@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["cierres.firmar", "cierres.ver"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

function firmar(input: { fecha: string; password: string; motivoDemora?: string; motivoDemoraDetalle?: string }) {
  return firmarCierre(input as Parameters<typeof firmarCierre>[0], { session: dtSession });
}

describe("firmarCierre", () => {
  beforeEach(() => {
    verifyPasswordMock.mockReset().mockResolvedValue(true);
    cargarUsuarioParaPasswordFirmaMock.mockReset().mockResolvedValue({ passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null });
    registrarFallaPasswordFirmaMock.mockClear();
    registrarExitoPasswordFirmaMock.mockClear();
    getDesignacionVigenteEnFechaMock.mockReset().mockResolvedValue({ id: DESIGNACION_ID, matricula: "MAT-1" });
    firmarCierreDbMock.mockReset().mockResolvedValue({
      id: "c1",
      fecha: FECHA,
      cantidadAsientos: 3,
      hashLote: "h",
      fueraDeTermino: false,
      motivoDemora: null,
      fechaFirma: new Date(),
    });
    jornadaActualTenantMock.mockReset().mockResolvedValue(FECHA);
    getPlazoFirmaDiasMock.mockReset().mockResolvedValue(0);
  });

  it("happy path: verifies the password FIRST, then resolves the SESSION's own designación (never a client-supplied id) and calls firmarCierreDb with directorTecnicoId = session.usuario.id", async () => {
    const result = await firmar({ fecha: FECHA, password: "correcta" });

    expect(result).toEqual({ id: "c1", fecha: FECHA, cantidadAsientos: 3, fueraDeTermino: false });
    expect(verifyPasswordMock).toHaveBeenCalledWith("hash", "correcta");
    expect(getDesignacionVigenteEnFechaMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, DT_USUARIO_ID, FECHA);
    expect(firmarCierreDbMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, fecha: FECHA, directorTecnicoId: DT_USUARIO_ID, designacionId: DESIGNACION_ID }),
    );
    // Order: password verification happens in its OWN transaction/command, strictly before the firming command.
    expect(verifyPasswordMock.mock.invocationCallOrder[0]!).toBeLessThan(firmarCierreDbMock.mock.invocationCallOrder[0]!);
  });

  it("wrong password: rejects with a DomainError, and NEVER resolves a designación or calls firmarCierreDb", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    await expect(firmar({ fecha: FECHA, password: "incorrecta" })).rejects.toBeInstanceOf(DomainError);
    expect(getDesignacionVigenteEnFechaMock).not.toHaveBeenCalled();
    expect(firmarCierreDbMock).not.toHaveBeenCalled();
    expect(registrarFallaPasswordFirmaMock).toHaveBeenCalled();
  });

  it("client cannot inject a director_tecnico_id/designacion_id: extra fields on the input are ignored, the resolved designación always wins", async () => {
    const maliciousInput = { fecha: FECHA, password: "correcta", directorTecnicoId: OTHER_USUARIO_ID, designacionId: "not-the-real-one" };
    await firmar(maliciousInput as unknown as Parameters<typeof firmar>[0]);

    expect(firmarCierreDbMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ directorTecnicoId: DT_USUARIO_ID, designacionId: DESIGNACION_ID }),
    );
  });

  it("no vigente designación at fecha: rejects with a clear DomainError, firmarCierreDb is never called", async () => {
    getDesignacionVigenteEnFechaMock.mockResolvedValue(null);

    await expect(firmar({ fecha: FECHA, password: "correcta" })).rejects.toBeInstanceOf(DomainError);
    expect(firmarCierreDbMock).not.toHaveBeenCalled();
  });

  it("fuera de término without motivo: rejected BEFORE calling firmarCierreDb (friendly app-level pre-check)", async () => {
    jornadaActualTenantMock.mockResolvedValue("2026-06-20"); // 5 days after fecha, plazoFirmaDias = 0

    await expect(firmar({ fecha: FECHA, password: "correcta" })).rejects.toBeInstanceOf(DomainError);
    expect(firmarCierreDbMock).not.toHaveBeenCalled();
  });

  it("fuera de término with OTRO and no detalle: rejected BEFORE calling firmarCierreDb", async () => {
    jornadaActualTenantMock.mockResolvedValue("2026-06-20");

    await expect(firmar({ fecha: FECHA, password: "correcta", motivoDemora: "OTRO" })).rejects.toBeInstanceOf(DomainError);
    expect(firmarCierreDbMock).not.toHaveBeenCalled();
  });
});

describe("verificarPasswordFirmaCommand (PIN is structurally impossible)", () => {
  it("the input schema has ONLY `password` -- a PIN-shaped payload with no password fails validation before any credential is ever read", async () => {
    await expect(verificarPasswordFirmaCommand.execute({ pin: "123456" }, { session: dtSession })).rejects.toBeInstanceOf(ValidationError);
    expect(cargarUsuarioParaPasswordFirmaMock).not.toHaveBeenCalled();
  });

  it("an empty password fails validation the same way", async () => {
    await expect(verificarPasswordFirmaCommand.execute({ password: "" }, { session: dtSession })).rejects.toBeInstanceOf(ValidationError);
  });
});
