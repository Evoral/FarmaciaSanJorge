/**
 * The huella as a verification method, server side (openspec/changes/metodos-verificacion-operador, spec S7/S8/S9,
 * "Método huella"): the real registry, the real code strategy and the real credential repository, against a fake
 * transaction. Only argon2, the audit writer and the usuario loader are replaced.
 *
 *   - identification: one match, none, AMBIGUA, a code shorter than 6 is a failed (audited) identification;
 *   - S7: the candidate query is the eligibility filter plus "has a huella", never a PIN;
 *   - the disabled method is rejected and audited as DESHABILITADO, with the huella's own message;
 *   - the PIN's generic message is byte-identical, and a huella rejection never carries the code anywhere.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { OPERADOR_ELEGIBLE } from "@/modules/auth/infrastructure/operador-elegible";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const verifyPasswordMock = vi.fn(async (hash: string, plain: string): Promise<boolean> => hash === `hash:${plain}`);
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (hash: string, plain: string) => verifyPasswordMock(hash, plain),
  hashPassword: vi.fn(),
}));

const loadUsuarioConPermisosMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
vi.mock("@/modules/auth/infrastructure/session-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/auth/infrastructure/session-repository")>()),
  loadUsuarioConPermisos: (...args: unknown[]) => loadUsuarioConPermisosMock(...args),
}));

const { verificarOperadorEnTx, MENSAJE_OPERADOR_RECHAZADO } = await import("@/modules/auth/application/verificar-operador");
const { REGISTRO } = await import("@/modules/auth/application/metodos-verificacion");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const SECTOR_ID = "22222222-2222-4222-a222-222222222222";
const ANA_ID = "33333333-3333-4333-a333-333333333333";
const BETO_ID = "44444444-4444-4444-a444-444444444444";
const CODIGO = "H-884213-secreto";

const findManyMock = vi.fn(async (...args: unknown[]): Promise<{ usuarioId: string; hash: string }[]> => {
  void args;
  return [];
});
const TX = { credencialOperador: { findMany: (...args: unknown[]) => findManyMock(...args) } } as unknown as Prisma.TransactionClient;

function sector(metodosHabilitados?: ReadonlySet<"PIN" | "HUELLA">): AuthenticatedSession {
  return {
    usuario: { id: SECTOR_ID, email: "laboratorio@example.com", nombre: "Laboratorio", apellido: "Fondo" },
    tenantId: TENANT_ID,
    sesionId: "sesion-sector",
    permisos: new Set(["preparaciones.confirmar"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: null,
    sector: { permisosConPin: new Set(["preparaciones.confirmar"]) as AuthenticatedSession["permisos"], ...(metodosHabilitados ? { metodosHabilitados } : {}) },
  };
}

const conHuella = sector(new Set(["PIN", "HUELLA"]));

function empleado(overrides: Record<string, unknown> = {}) {
  return {
    id: ANA_ID,
    tenantId: TENANT_ID,
    email: "ana@example.com",
    nombre: "Ana",
    apellido: "Gómez",
    estado: "ACTIVO",
    esSector: false,
    esTecnico: false,
    debeCambiarPassword: false,
    permisos: new Set(["preparaciones.confirmar"]),
    ...overrides,
  };
}

const huella = (codigo: string) => ({ prueba: { metodo: "HUELLA", huella: codigo } });

function auditado(): string {
  return JSON.stringify(auditRecordMock.mock.calls.map((call) => call[1]));
}

beforeEach(() => {
  auditRecordMock.mockClear();
  verifyPasswordMock.mockClear();
  findManyMock.mockReset().mockResolvedValue([]);
  loadUsuarioConPermisosMock.mockReset().mockResolvedValue(empleado());
});

describe("HUELLA identification", () => {
  it("identifies the empleado whose enrolled code matches, and says it was the huella", async () => {
    findManyMock.mockResolvedValue([
      { usuarioId: ANA_ID, hash: `hash:${CODIGO}` },
      { usuarioId: BETO_ID, hash: "hash:otro-codigo-1" },
    ]);

    const resultado = await verificarOperadorEnTx(TX, conHuella, huella(CODIGO));

    expect(resultado).toMatchObject({ ok: true, metodo: "HUELLA", operador: { id: ANA_ID } });
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("rejects a code that matches nobody with the huella's message, audited, never attributing it", async () => {
    findManyMock.mockResolvedValue([{ usuarioId: BETO_ID, hash: "hash:otro-codigo-1" }]);

    const resultado = await verificarOperadorEnTx(TX, conHuella, huella(CODIGO));

    expect(resultado).toEqual({ ok: false, message: "La huella no corresponde a ningún empleado habilitado." });
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    const registro = auditRecordMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(registro).toMatchObject({ tenantId: TENANT_ID, usuarioId: SECTOR_ID, entidad: "operador", entidadId: SECTOR_ID, accion: "AUTORIZAR" });
    expect(registro.motivo).toContain("método HUELLA");
    expect(registro.motivo).toContain("NO_RECONOCIDA");
  });

  it("rejects AMBIGUA when two empleados hold the same code, checking every candidate", async () => {
    findManyMock.mockResolvedValue([
      { usuarioId: ANA_ID, hash: `hash:${CODIGO}` },
      { usuarioId: BETO_ID, hash: `hash:${CODIGO}` },
      { usuarioId: "5", hash: "hash:otro-codigo-1" },
    ]);

    const resultado = await verificarOperadorEnTx(TX, conHuella, huella(CODIGO));

    expect(resultado).toEqual({ ok: false, message: REGISTRO.HUELLA.rechazo.AMBIGUA });
    expect(verifyPasswordMock).toHaveBeenCalledTimes(3);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ motivo: expect.stringContaining("AMBIGUA") });
  });

  it("a code shorter than 6 is a failed identification: audited, nothing scanned, nothing stored", async () => {
    const resultado = await verificarOperadorEnTx(TX, conHuella, huella("12345"));

    expect(resultado).toEqual({ ok: false, message: "La huella no corresponde a ningún empleado habilitado." });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditado()).not.toContain("12345");
  });

  it("accepts exactly 6 characters", async () => {
    findManyMock.mockResolvedValue([{ usuarioId: ANA_ID, hash: "hash:123456" }]);
    await expect(verificarOperadorEnTx(TX, conHuella, huella("123456"))).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["without the code", { prueba: { metodo: "HUELLA" } }],
    ["empty", huella("")],
    ["too long", huella("x".repeat(129))],
  ])("a malformed proof (%s) is rejected with the huella's generic message, before scanning", async (_caso, malformada) => {
    const resultado = await verificarOperadorEnTx(TX, conHuella, malformada);
    expect(resultado).toEqual({ ok: false, message: REGISTRO.HUELLA.rechazoGenerico });
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("HUELLA candidates (S7)", () => {
  it("asks only for the eligible empleados of the tenant that hold a huella, and never looks at a PIN", async () => {
    await verificarOperadorEnTx(TX, conHuella, huella(CODIGO));

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const consulta = findManyMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(consulta.where).toEqual({ tenantId: TENANT_ID, metodo: "HUELLA", usuario: { ...OPERADOR_ELEGIBLE } });
    expect(JSON.stringify(consulta)).not.toMatch(/pin/i);
  });

  it.each([
    ["suspended", { estado: "SUSPENDIDO" }],
    ["with a pending password change", { debeCambiarPassword: true }],
    ["a cuenta de sector", { esSector: true }],
    ["the technical usuario", { esTecnico: true }],
    ["from another tenant", { tenantId: "99999999-9999-4999-a999-999999999999" }],
  ])("re-checks the identified empleado (%s): rejected with the huella's generic message, audited", async (_caso, cambios) => {
    findManyMock.mockResolvedValue([{ usuarioId: ANA_ID, hash: `hash:${CODIGO}` }]);
    loadUsuarioConPermisosMock.mockResolvedValue(empleado(cambios));

    const resultado = await verificarOperadorEnTx(TX, conHuella, huella(CODIGO));

    expect(resultado).toEqual({ ok: false, message: REGISTRO.HUELLA.rechazoGenerico });
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ usuarioId: SECTOR_ID, entidad: "operador", accion: "AUTORIZAR" });
  });
});

describe("HUELLA enablement gate", () => {
  it.each([
    ["no set loaded (fail-closed)", sector()],
    ["a set with the PIN only", sector(new Set(["PIN"]))],
  ])("rejects it when the farmacia has not enabled it (%s): the huella's message, audited DESHABILITADO, nothing scanned", async (_caso, sesion) => {
    findManyMock.mockResolvedValue([{ usuarioId: ANA_ID, hash: `hash:${CODIGO}` }]);

    const resultado = await verificarOperadorEnTx(TX, sesion, huella(CODIGO));

    expect(resultado).toEqual({ ok: false, message: REGISTRO.HUELLA.rechazoGenerico });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(loadUsuarioConPermisosMock).not.toHaveBeenCalled();
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ motivo: expect.stringContaining("DESHABILITADO") });
    expect(auditado()).not.toContain(CODIGO);
  });
});

describe("rejection messages", () => {
  it("keeps the PIN's generic message byte-identical, and an unknown method gets it too", async () => {
    const historico = "No se pudo identificar al empleado. Volvé a ingresar el PIN.";
    expect(MENSAJE_OPERADOR_RECHAZADO).toBe(historico);
    expect(REGISTRO.PIN.rechazoGenerico).toBe(historico);
    await expect(verificarOperadorEnTx(TX, conHuella, { prueba: { metodo: "BIOMETRIA", pin: "4829" } })).resolves.toEqual({ ok: false, message: historico });
  });

  it("gives every method its own text and the huella never asks for the PIN", () => {
    expect(REGISTRO.HUELLA.rechazoGenerico).toBe("No se pudo identificar al empleado. Volvé a pasar la huella.");
    expect(REGISTRO.HUELLA.rechazoGenerico).not.toContain("PIN");
    expect(REGISTRO.HUELLA.rechazo.NO_RECONOCIDA).not.toContain("PIN");
    expect(REGISTRO.HUELLA.rechazo.AMBIGUA).not.toContain("PIN");
  });

  it("the code never reaches the audit of any rejection path", async () => {
    findManyMock.mockResolvedValue([{ usuarioId: BETO_ID, hash: "hash:otro-codigo-1" }]);
    await verificarOperadorEnTx(TX, conHuella, huella(CODIGO)); // not recognized
    await verificarOperadorEnTx(TX, sector(), huella(CODIGO)); // disabled
    findManyMock.mockResolvedValue([{ usuarioId: ANA_ID, hash: `hash:${CODIGO}` }]);
    loadUsuarioConPermisosMock.mockResolvedValue(empleado({ estado: "SUSPENDIDO" }));
    await verificarOperadorEnTx(TX, conHuella, huella(CODIGO)); // identified, not eligible

    expect(auditRecordMock).toHaveBeenCalledTimes(3);
    expect(auditado()).not.toContain(CODIGO);
    expect(auditado()).not.toContain(`hash:${CODIGO}`);
  });
});
