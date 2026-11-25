/**
 * `operadores.metodosVerificacion.configurar` / `.listar` and the pure helpers behind them
 * (openspec/changes/metodos-verificacion-operador). No optional method exists yet, so the catalog is extended in memory
 * with a fake one before the command is loaded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError, DomainError } from "@/shared/errors";
import { METODOS, METODOS_OPCIONALES, METODOS_VERIFICACION, type MetodoVerificacion } from "@/modules/auth/domain/verificacion-identidad";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true }),
}));
vi.mock("@/shared/auth/session", () => ({
  requireSession: async () => {
    throw new Error("requireSession() unexpectedly called: the session is injected");
  },
  requireRecentReauth: vi.fn(),
}));

const getMetodosHabilitadosMock = vi.fn(async (...args: unknown[]): Promise<string[]> => {
  void args;
  return [];
});
const lockMetodosHabilitadosMock = vi.fn(async (...args: unknown[]): Promise<void> => {
  void args;
});
const replaceMetodosHabilitadosMock = vi.fn(async (...args: unknown[]): Promise<void> => {
  void args;
});
vi.mock("@/modules/operadores/infrastructure/operadores-repository", () => ({
  getMetodosHabilitados: (...args: unknown[]) => getMetodosHabilitadosMock(...args),
  lockMetodosHabilitados: (...args: unknown[]) => lockMetodosHabilitadosMock(...args),
  replaceMetodosHabilitados: (...args: unknown[]) => replaceMetodosHabilitadosMock(...args),
}));

const FAKE = "FAKE" as MetodoVerificacion;
Object.assign(METODOS, { FAKE: { metodo: FAKE, etiqueta: "Fake", claves: ["codigo"], siempreHabilitado: false, almacen: "CREDENCIAL_OPERADOR" } });
(METODOS_VERIFICACION as MetodoVerificacion[]).push(FAKE);
(METODOS_OPCIONALES as MetodoVerificacion[]).push(FAKE);

const { configurarMetodosVerificacionCommand } = await import("@/modules/operadores/application/configurar-metodos-verificacion");
const { listMetodosVerificacionQuery } = await import("@/modules/operadores/application/list-metodos-verificacion");
const { diferenciaMetodos, ordenarMetodos, describirMetodosConfigurables } = await import("@/modules/operadores/domain/metodos-verificacion");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function sesion(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "usuario-1", email: "a@example.com", nombre: "A", apellido: "B" },
    tenantId: TENANT_ID,
    sesionId: "sesion-1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

beforeEach(() => {
  auditRecordMock.mockClear();
  getMetodosHabilitadosMock.mockReset().mockResolvedValue([]);
  replaceMetodosHabilitadosMock.mockClear();
  lockMetodosHabilitadosMock.mockClear();
});

describe("helpers", () => {
  it("ordenarMetodos de-duplicates and keeps catalog order", () => {
    expect(ordenarMetodos([FAKE, FAKE])).toEqual([FAKE]);
    expect(ordenarMetodos([])).toEqual([]);
  });

  it("diferenciaMetodos says what was switched on and off", () => {
    expect(diferenciaMetodos([], [FAKE])).toEqual({ activados: [FAKE], desactivados: [] });
    expect(diferenciaMetodos([FAKE], [])).toEqual({ activados: [], desactivados: [FAKE] });
    expect(diferenciaMetodos([FAKE], [FAKE])).toEqual({ activados: [], desactivados: [] });
  });

  it("describirMetodosConfigurables lists only optional methods, never the PIN", () => {
    expect(describirMetodosConfigurables([FAKE])).toEqual([{ metodo: FAKE, etiqueta: "Fake", habilitado: true }]);
    expect(describirMetodosConfigurables([]).map((fila) => fila.metodo)).not.toContain("PIN");
  });
});

describe("operadores.metodosVerificacion.configurar", () => {
  it("is config.editar: a session without it is denied before anything runs", async () => {
    await expect(configurarMetodosVerificacionCommand.execute({ metodos: [FAKE] }, { session: sesion(["config.ver"]) })).rejects.toBeInstanceOf(AuthorizationError);
    expect(replaceMetodosHabilitadosMock).not.toHaveBeenCalled();
  });

  it("rejects the PIN: it is always on and cannot be switched", async () => {
    await expect(configurarMetodosVerificacionCommand.execute({ metodos: ["PIN"] }, { session: sesion(["config.editar"]) })).rejects.toThrow();
    expect(replaceMetodosHabilitadosMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown method", async () => {
    await expect(configurarMetodosVerificacionCommand.execute({ metodos: ["OTRO"] as never }, { session: sesion(["config.editar"]) })).rejects.toThrow();
    expect(replaceMetodosHabilitadosMock).not.toHaveBeenCalled();
  });

  it("stores the new set and audits before/after with what was switched on", async () => {
    const resultado = await configurarMetodosVerificacionCommand.execute({ metodos: [FAKE, FAKE] }, { session: sesion(["config.editar"]) });

    expect(resultado).toEqual({ metodos: [FAKE] });
    expect(replaceMetodosHabilitadosMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, [FAKE]);
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({
      entidad: "metodo_verificacion",
      entidadId: TENANT_ID,
      accion: "MODIFICAR",
      valorAnterior: { metodos: [] },
      valorNuevo: { metodos: [FAKE], activados: [FAKE], desactivados: [] },
    });
  });

  it("takes the per-farmacia lock BEFORE reading the set and writing it, so two concurrent saves are serialized", async () => {
    await configurarMetodosVerificacionCommand.execute({ metodos: [FAKE] }, { session: sesion(["config.editar"]) });

    expect(lockMetodosHabilitadosMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID);
    const orden = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0]!;
    expect(orden(lockMetodosHabilitadosMock)).toBeLessThan(orden(getMetodosHabilitadosMock));
    expect(orden(getMetodosHabilitadosMock)).toBeLessThan(orden(replaceMetodosHabilitadosMock));
  });

  it("audits what was switched off", async () => {
    getMetodosHabilitadosMock.mockResolvedValue([FAKE]);
    await configurarMetodosVerificacionCommand.execute({ metodos: [] }, { session: sesion(["config.editar"]) });

    expect(replaceMetodosHabilitadosMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, []);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ valorAnterior: { metodos: [FAKE] }, valorNuevo: { metodos: [], activados: [], desactivados: [FAKE] } });
  });

  it("a no-op is rejected: nothing written, nothing audited", async () => {
    getMetodosHabilitadosMock.mockResolvedValue([FAKE]);
    await expect(configurarMetodosVerificacionCommand.execute({ metodos: [FAKE] }, { session: sesion(["config.editar"]) })).rejects.toBeInstanceOf(DomainError);
    expect(replaceMetodosHabilitadosMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });
});

describe("operadores.metodosVerificacion.listar", () => {
  it("is config.ver and returns every optional method with whether it is on", async () => {
    getMetodosHabilitadosMock.mockResolvedValue([FAKE]);
    expect(await listMetodosVerificacionQuery.execute({}, { session: sesion(["config.ver"]) })).toEqual([{ metodo: FAKE, etiqueta: "Fake", habilitado: true }]);

    getMetodosHabilitadosMock.mockResolvedValue([]);
    expect(await listMetodosVerificacionQuery.execute({}, { session: sesion(["config.ver"]) })).toEqual([{ metodo: FAKE, etiqueta: "Fake", habilitado: false }]);
  });

  it("a session without config.ver is denied", async () => {
    await expect(listMetodosVerificacionQuery.execute({}, { session: sesion([]) })).rejects.toBeInstanceOf(AuthorizationError);
  });
});
