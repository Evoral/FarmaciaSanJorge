/**
 * Per-farmacia enablement of verification methods, server gate (openspec/changes/metodos-verificacion-operador,
 * spec "Métodos de verificación por farmacia"). No optional method exists yet, so the catalog is extended in memory
 * with a fake one BEFORE the verifier is loaded: this proves the gate for the first real optional method (the huella)
 * without shipping one.
 *
 *   - `metodoHabilitado`: always-on methods are accepted whatever the set says; an absent set means "always-on only";
 *   - `verificarOperadorEnTx`: a disabled method is rejected BEFORE anything is scanned, with the generic message and
 *     an audit row whose internal reason is DESHABILITADO; an enabled one proceeds; the PIN never needs a row;
 *   - `loadMetodosHabilitados`: seeded with the always-on methods, plus the stored optional ones.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { METODOS, METODOS_OPCIONALES, METODOS_SIEMPRE_HABILITADOS, METODOS_VERIFICACION, metodoHabilitado, type MetodoVerificacion } from "@/modules/auth/domain/verificacion-identidad";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const loadUsuarioConPermisosMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
vi.mock("@/modules/auth/infrastructure/session-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/auth/infrastructure/session-repository")>()),
  loadUsuarioConPermisos: (...args: unknown[]) => loadUsuarioConPermisosMock(...args),
}));

const identificarMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return { ok: true, usuarioId: "33333333-3333-4333-a333-333333333333" };
});
const MENSAJE_FAKE = "No se pudo identificar al empleado. Volvé a usar el método de prueba.";
vi.mock("@/modules/auth/application/metodos-verificacion", async () => {
  const { z } = await import("zod");
  const entrada = (metodo: string, clave: string) => ({
    prueba: z.object({ metodo: z.literal(metodo), [clave]: z.string().min(1) }),
    identificador: { metodo, identificar: (...args: unknown[]) => identificarMock(...args) },
    rechazo: { NO_RECONOCIDA: "no reconocida", AMBIGUA: "ambigua" },
    rechazoGenerico: metodo === "FAKE" ? MENSAJE_FAKE : "No se pudo identificar al empleado. Volvé a ingresar el PIN.",
  });
  return { entradaDe: (metodo: string) => (metodo === "FAKE" ? entrada("FAKE", "codigo") : entrada("PIN", "pin")) };
});

// The catalog gains an optional method before anything derived from it is evaluated.
const FAKE = "FAKE" as MetodoVerificacion;
Object.assign(METODOS, { FAKE: { metodo: FAKE, etiqueta: "Fake", claves: ["codigo"], siempreHabilitado: false, almacen: "CREDENCIAL_OPERADOR" } });
(METODOS_VERIFICACION as MetodoVerificacion[]).push(FAKE);
(METODOS_OPCIONALES as MetodoVerificacion[]).push(FAKE);

const { verificarOperadorEnTx } = await import("@/modules/auth/application/verificar-operador");
const { loadMetodosHabilitados } = await import("@/modules/auth/infrastructure/session-repository");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const SECTOR_ID = "22222222-2222-4222-a222-222222222222";
const EMPLEADO_ID = "33333333-3333-4333-a333-333333333333";
const TX = { __fakeTx: true } as never as Prisma.TransactionClient;

function sector(metodosHabilitados?: ReadonlySet<MetodoVerificacion>): AuthenticatedSession {
  return {
    usuario: { id: SECTOR_ID, email: "laboratorio@example.com", nombre: "Laboratorio", apellido: "Fondo" },
    tenantId: TENANT_ID,
    sesionId: "sesion-sector",
    permisos: new Set(["preparaciones.confirmar"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: null,
    sector: { permisosConPin: new Set(["preparaciones.confirmar"]) as AuthenticatedSession["permisos"], ...(metodosHabilitados ? { metodosHabilitados } : {}) },
  };
}

const empleado = {
  id: EMPLEADO_ID,
  tenantId: TENANT_ID,
  email: "ana@example.com",
  nombre: "Ana",
  apellido: "Gómez",
  estado: "ACTIVO",
  esSector: false,
  esTecnico: false,
  debeCambiarPassword: false,
  permisos: new Set(["preparaciones.confirmar"]),
};

const credencialFake = { prueba: { metodo: "FAKE", codigo: "123456" } };
const credencialPin = { prueba: { metodo: "PIN", pin: "4829" } };

beforeEach(() => {
  auditRecordMock.mockClear();
  identificarMock.mockClear();
  loadUsuarioConPermisosMock.mockReset().mockResolvedValue(empleado);
});

describe("metodoHabilitado", () => {
  it("the PIN is accepted whatever the set says (it is code, not a row)", () => {
    expect(metodoHabilitado("PIN", undefined)).toBe(true);
    expect(metodoHabilitado("PIN", new Set())).toBe(true);
  });

  it("an optional method needs to be in the set; an absent set accepts only the always-on ones", () => {
    expect(metodoHabilitado(FAKE, undefined)).toBe(false);
    expect(metodoHabilitado(FAKE, new Set(["PIN"]))).toBe(false);
    expect(metodoHabilitado(FAKE, new Set([FAKE]))).toBe(true);
  });
});

describe("verificarOperadorEnTx: server gate", () => {
  it("rejects a disabled optional method (absent set) with the method's own generic message, audited as DESHABILITADO, before scanning anything", async () => {
    const resultado = await verificarOperadorEnTx(TX, sector(), credencialFake);

    expect(resultado).toEqual({ ok: false, message: MENSAJE_FAKE });
    expect(identificarMock).not.toHaveBeenCalled();
    expect(loadUsuarioConPermisosMock).not.toHaveBeenCalled();
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    const registro = auditRecordMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(registro).toMatchObject({ tenantId: TENANT_ID, usuarioId: SECTOR_ID, entidad: "operador", entidadId: SECTOR_ID, accion: "AUTORIZAR" });
    expect(registro.motivo).toContain("método FAKE");
    expect(registro.motivo).toContain("DESHABILITADO");
    expect(JSON.stringify(registro)).not.toContain("123456");
  });

  it("rejects it too when the set exists but lacks the method", async () => {
    const resultado = await verificarOperadorEnTx(TX, sector(new Set(["PIN"])), credencialFake);
    expect(resultado).toEqual({ ok: false, message: MENSAJE_FAKE });
    expect(identificarMock).not.toHaveBeenCalled();
  });

  it("proceeds when the farmacia has the method enabled", async () => {
    const resultado = await verificarOperadorEnTx(TX, sector(new Set(["PIN", FAKE])), credencialFake);

    expect(resultado).toMatchObject({ ok: true, metodo: "FAKE", operador: { id: EMPLEADO_ID } });
    expect(identificarMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("the PIN proceeds with an absent set and with an empty one", async () => {
    for (const habilitados of [undefined, new Set<MetodoVerificacion>()]) {
      identificarMock.mockClear();
      const resultado = await verificarOperadorEnTx(TX, sector(habilitados), credencialPin);
      expect(resultado).toMatchObject({ ok: true, metodo: "PIN" });
      expect(identificarMock).toHaveBeenCalledTimes(1);
    }
  });
});

describe("loadMetodosHabilitados", () => {
  function txConFilas(metodos: string[]) {
    const findMany = vi.fn(async () => metodos.map((metodo) => ({ metodo })));
    return { tx: { metodoVerificacionHabilitado: { findMany } } as unknown as Prisma.TransactionClient, findMany };
  }

  it("is seeded with the always-on methods when nothing is stored", async () => {
    const { tx, findMany } = txConFilas([]);
    const habilitados = await loadMetodosHabilitados(tx, TENANT_ID);
    expect([...habilitados]).toEqual([...METODOS_SIEMPRE_HABILITADOS]);
    expect(findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID }, select: { metodo: true } });
  });

  it("adds the stored optional methods and ignores anything the app does not offer as optional", async () => {
    const { tx } = txConFilas([FAKE, "PIN", "DESCONOCIDO"]);
    const habilitados = await loadMetodosHabilitados(tx, TENANT_ID);
    expect(habilitados.has(FAKE)).toBe(true);
    expect(habilitados.has("PIN")).toBe(true);
    expect(habilitados.has("DESCONOCIDO" as MetodoVerificacion)).toBe(false);
  });
});
