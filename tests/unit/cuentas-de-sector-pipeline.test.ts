/**
 * Cuentas de sector (openspec/specs/cuentas-de-sector/spec.md): how shared/usecase.ts
 * attributes a command run from a shared session. The verification itself
 * (`verificarOperadorEnTx`) is mocked here -- its own rules are covered by
 * tests/unit/cuentas-de-sector-verificar-operador.test.ts -- so these tests
 * prove the PIPELINE: who the handler and the audit row see, which permisos
 * apply, and what happens without / with a bad credential.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { AuthenticatedSession } from "@/shared/auth/session";
import type { VerificacionDeOperador } from "@/shared/auth/operador";
import { AuthorizationError, DomainError, OperadorRequeridoError, StepUpRequiredError } from "@/shared/errors";
import { CAMPO_OPERADOR_PIN } from "@/shared/auth/operador-campos";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called");
  }),
  // The REAL step-up rule: these tests assert when it is (not) applied.
  requireRecentReauth: (session: AuthenticatedSession) => {
    if (session.reautenticadaEn === null) throw new StepUpRequiredError();
  },
}));

const verificarOperadorMock = vi.fn(async (...args: unknown[]): Promise<VerificacionDeOperador> => {
  void args;
  return { ok: false, message: "sin configurar" };
});
vi.mock("@/shared/auth/operador", () => ({
  verificarOperadorEnTx: (...args: unknown[]) => verificarOperadorMock(...args),
}));

const { defineCommand, defineQuery, resetUsecaseRegistryForTests } = await import("@/shared/usecase");
const { conOperador, ejecutarConOperador } = await import("@/shared/auth/operador-context");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const SECTOR_ID = "22222222-2222-4222-a222-222222222222";
const EMPLEADO_ID = "33333333-3333-4333-a333-333333333333";

type Permisos = AuthenticatedSession["permisos"];

function sesionDeSector(permisos: string[], conPin: string[]): AuthenticatedSession {
  return {
    usuario: { id: SECTOR_ID, email: "laboratorio@example.com", nombre: "Laboratorio", apellido: "Fondo" },
    tenantId: TENANT_ID,
    sesionId: "sesion-sector",
    permisos: new Set(permisos) as Permisos,
    reautenticadaEn: null,
    sector: { permisosConPin: new Set(conPin) as Permisos },
  };
}

function empleadoVerificado(permisos: string[]): VerificacionDeOperador {
  return {
    ok: true,
    metodo: "PIN",
    operador: { id: EMPLEADO_ID, email: "ana@example.com", nombre: "Ana", apellido: "Gómez", permisos: new Set(permisos) as Permisos },
  };
}

const CREDENCIAL = { prueba: { metodo: "PIN", pin: "4829" } };

/** A command guarded on `preparaciones.confirmar` that reports the session its handler received. */
function comandoQueInforma(opciones: { requireRecentReauth?: boolean } = {}) {
  return defineCommand({
    name: "test.confirmar",
    permiso: "preparaciones.confirmar",
    input: z.object({}),
    ...(opciones.requireRecentReauth ? { requireRecentReauth: { maxAgeMinutes: 15 } } : {}),
    audit: { entidad: "preparacion", accion: "CONFIRMAR" },
    handler: async ({ session }) => ({ output: session, audit: { entidadId: "44444444-4444-4444-a444-444444444444" } }),
  });
}

beforeEach(() => {
  resetUsecaseRegistryForTests();
  auditRecordMock.mockClear();
  withTenantTransactionMock.mockClear();
  verificarOperadorMock.mockReset();
});

describe("acción con PIN en una cuenta de sector", () => {
  const sector = sesionDeSector(["preparaciones.confirmar", "stock.ver"], ["preparaciones.confirmar"]);

  it("sin empleado identificado: OperadorRequeridoError, sin abrir ninguna transacción", async () => {
    const comando = comandoQueInforma();
    await expect(comando.execute({}, { session: sector })).rejects.toBeInstanceOf(OperadorRequeridoError);
    await expect(ejecutarConOperador(null, () => comando.execute({}, { session: sector }))).rejects.toBeInstanceOf(OperadorRequeridoError);
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
    expect(verificarOperadorMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("con PIN válido: el handler y la auditoría ven al EMPLEADO, con permisos = sector ∩ empleado y la terminal de origen", async () => {
    verificarOperadorMock.mockResolvedValue(empleadoVerificado(["preparaciones.confirmar", "recetas.crear"]));
    const comando = comandoQueInforma();

    const recibida = await ejecutarConOperador(CREDENCIAL, () => comando.execute({}, { session: sector }));

    expect(recibida.usuario).toEqual({ id: EMPLEADO_ID, email: "ana@example.com", nombre: "Ana", apellido: "Gómez" });
    // Not `stock.ver` (the empleado lacks it) nor `recetas.crear` (the cuenta de sector lacks it).
    expect([...recibida.permisos]).toEqual(["preparaciones.confirmar"]);
    expect(recibida.terminal).toEqual({ usuarioId: SECTOR_ID, nombre: "Laboratorio Fondo", sesionId: "sesion-sector", verificacion: "PIN" });
    expect(recibida.tenantId).toBe(TENANT_ID);

    expect(verificarOperadorMock).toHaveBeenCalledWith(expect.anything(), sector, CREDENCIAL);
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ usuarioId: EMPLEADO_ID, entidad: "preparacion", accion: "CONFIRMAR" });
  });

  it("el empleado identificado cumple el step-up (INV-X02): no se le pide además la reautenticación de la cuenta", async () => {
    verificarOperadorMock.mockResolvedValue(empleadoVerificado(["preparaciones.confirmar"]));
    const comando = comandoQueInforma({ requireRecentReauth: true });
    await expect(ejecutarConOperador(CREDENCIAL, () => comando.execute({}, { session: sector }))).resolves.toMatchObject({ usuario: { id: EMPLEADO_ID } });
  });

  it("PIN rechazado: DomainError sobre el campo del PIN, el handler no corre", async () => {
    verificarOperadorMock.mockResolvedValue({ ok: false, message: "El PIN no es correcto." });
    const comando = comandoQueInforma();
    const error = await ejecutarConOperador(CREDENCIAL, () => comando.execute({}, { session: sector })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("El PIN no es correcto.");
    expect((error as DomainError).fields).toEqual([CAMPO_OPERADOR_PIN]);
    // Only the verification's own short transaction ran.
    expect(withTenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("empleado SIN ese permiso en sus propios roles: AuthorizationError, auditado ACCESO_DENEGADO a su nombre", async () => {
    verificarOperadorMock.mockResolvedValue(empleadoVerificado(["recetas.crear", "entregas.registrar"]));
    const comando = comandoQueInforma();
    await expect(ejecutarConOperador(CREDENCIAL, () => comando.execute({}, { session: sector }))).rejects.toBeInstanceOf(AuthorizationError);
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ usuarioId: EMPLEADO_ID, entidad: "acceso", accion: "ACCESO_DENEGADO" });
  });

  it("una acción que encadena dos comandos verifica el PIN una sola vez", async () => {
    verificarOperadorMock.mockResolvedValue(empleadoVerificado(["preparaciones.confirmar"]));
    const comando = comandoQueInforma();
    await ejecutarConOperador(CREDENCIAL, async () => {
      await comando.execute({}, { session: sector });
      await comando.execute({}, { session: sector });
    });
    expect(verificarOperadorMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock).toHaveBeenCalledTimes(2);
  });

  it("la cuenta de sector debe tener el permiso ella misma: sin él, se rechaza antes de pedir ningún PIN", async () => {
    const sinPermiso = sesionDeSector(["stock.ver"], ["preparaciones.confirmar"]);
    const comando = comandoQueInforma();
    await expect(ejecutarConOperador(CREDENCIAL, () => comando.execute({}, { session: sinPermiso }))).rejects.toBeInstanceOf(AuthorizationError);
    expect(verificarOperadorMock).not.toHaveBeenCalled();
  });
});

describe("lo que NO pide PIN", () => {
  it("una acción sin PIN en la cuenta de sector queda a nombre de la cuenta, aunque la solicitud traiga una credencial (que igual se verifica)", async () => {
    verificarOperadorMock.mockResolvedValue(empleadoVerificado(["preparaciones.confirmar"]));
    const sector = sesionDeSector(["preparaciones.confirmar"], ["stock.ajuste.registrar"]);
    const comando = comandoQueInforma();
    const recibida = await ejecutarConOperador(CREDENCIAL, () => comando.execute({}, { session: sector }));
    expect(recibida.usuario.id).toBe(SECTOR_ID);
    expect(recibida.terminal ?? null).toBeNull();
    expect(verificarOperadorMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ usuarioId: SECTOR_ID });
  });

  it("con un PIN erróneo en la solicitud, una acción sin PIN tampoco corre: se rechaza en el campo PIN sin ejecutar el comando", async () => {
    verificarOperadorMock.mockResolvedValue({ ok: false, message: "El PIN no corresponde a ningún empleado habilitado." });
    const sector = sesionDeSector(["preparaciones.confirmar"], ["stock.ajuste.registrar"]);
    const comando = comandoQueInforma();
    const error = await ejecutarConOperador(CREDENCIAL, () => comando.execute({}, { session: sector })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("El PIN no corresponde a ningún empleado habilitado.");
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("una sesión individual nunca pide PIN y conserva su step-up", async () => {
    const individual: AuthenticatedSession = { ...sesionDeSector(["preparaciones.confirmar"], []), sector: null };
    await expect(comandoQueInforma().execute({}, { session: individual })).resolves.toMatchObject({ usuario: { id: SECTOR_ID } });
    resetUsecaseRegistryForTests();
    await expect(comandoQueInforma({ requireRecentReauth: true }).execute({}, { session: individual })).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it("las consultas nunca piden PIN", async () => {
    const sector = sesionDeSector(["preparaciones.confirmar"], ["preparaciones.confirmar"]);
    const consulta = defineQuery({ name: "test.leer", permiso: "preparaciones.confirmar", input: z.object({}), handler: async ({ session }) => session.usuario.id });
    await expect(consulta.execute({}, { session: sector })).resolves.toBe(SECTOR_ID);
  });
});

describe("conOperador (Server Actions)", () => {
  const sector = sesionDeSector(["preparaciones.confirmar"], ["preparaciones.confirmar"]);

  function formData(campos: Record<string, string>): FormData {
    const data = new FormData();
    for (const [nombre, valor] of Object.entries(campos)) data.set(nombre, valor);
    return data;
  }

  /** A Server Action body shaped like the real ones: it catches everything and returns an action state. */
  async function accion(): Promise<{ status: "success" } | { status: "error"; message: string }> {
    try {
      await comandoQueInforma().execute({}, { session: sector });
      return { status: "success" };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "?" };
    }
  }

  it("sin credencial en el formulario: el error de la acción se reemplaza por operador-required", async () => {
    await expect(conOperador(formData({ preparacionId: "x" }), accion)).resolves.toEqual({ status: "operador-required" });
  });

  it("con los campos del operador: la credencial llega al pipeline y la acción se completa", async () => {
    verificarOperadorMock.mockResolvedValue(empleadoVerificado(["preparaciones.confirmar"]));
    await expect(conOperador(formData({ [CAMPO_OPERADOR_PIN]: "4829" }), accion)).resolves.toEqual({ status: "success" });
    expect(verificarOperadorMock).toHaveBeenCalledWith(expect.anything(), sector, { prueba: { metodo: "PIN", pin: "4829" } });
  });

  it("un PIN rechazado sigue siendo un error (con su mensaje), no un operador-required", async () => {
    verificarOperadorMock.mockResolvedValue({ ok: false, message: "El PIN no es correcto." });
    await expect(conOperador(formData({ [CAMPO_OPERADOR_PIN]: "0000" }), accion)).resolves.toEqual({
      status: "error",
      message: "El PIN no es correcto.",
    });
  });
});
