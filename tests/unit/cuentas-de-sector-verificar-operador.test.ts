/**
 * Cuentas de sector (docs/specs/cuentas-de-sector.md): identifying the
 * empleado who acts from a shared session.
 *
 *   - pure rules: who may be an operador, what a cuenta de sector can never
 *     hold, which acciones are configurable;
 *   - `verificarOperadorEnTx` with the repositories mocked: an accepted PIN,
 *     every rejection (wrong / blocked / no PIN / not an empleado / other
 *     tenant / malformed), the failed-attempt counter, the audit of a
 *     rejection, and that argon2 ALWAYS runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { decideCandidatoOperador } from "@/modules/auth/domain/operador-policy";
import {
  PERMISO_CATALOGO,
  PERMISOS_CON_PIN_CONFIGURABLES,
  PERMISOS_CON_PIN_POR_DEFECTO,
  PERMISOS_VEDADOS_A_SECTOR,
  permisosEfectivos,
} from "@/modules/auth/domain/permisos";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return false;
});
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

const loadUsuarioConPermisosMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
vi.mock("@/modules/auth/infrastructure/session-repository", () => ({
  loadUsuarioConPermisos: (...args: unknown[]) => loadUsuarioConPermisosMock(...args),
}));

const loadPinEstadoMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
const recordPinFailureMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
const resetPinLockoutMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadPinEstado: (...args: unknown[]) => loadPinEstadoMock(...args),
  recordPinFailure: (...args: unknown[]) => recordPinFailureMock(...args),
  resetPinLockout: (...args: unknown[]) => resetPinLockoutMock(...args),
}));

const { verificarOperadorEnTx, MENSAJE_OPERADOR_RECHAZADO } = await import("@/modules/auth/application/verificar-operador");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const OTRO_TENANT_ID = "99999999-9999-4999-a999-999999999999";
const SECTOR_ID = "22222222-2222-4222-a222-222222222222";
const EMPLEADO_ID = "33333333-3333-4333-a333-333333333333";
const TX = { __fakeTx: true } as never;

const sector: AuthenticatedSession = {
  usuario: { id: SECTOR_ID, email: "laboratorio@example.com", nombre: "Laboratorio", apellido: "Fondo" },
  tenantId: TENANT_ID,
  sesionId: "sesion-sector",
  permisos: new Set(["preparaciones.confirmar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: null,
  sector: { permisosConPin: new Set(["preparaciones.confirmar"]) as AuthenticatedSession["permisos"] },
};

function empleado(extra: Record<string, unknown> = {}) {
  return {
    id: EMPLEADO_ID,
    tenantId: TENANT_ID,
    email: "ana@example.com",
    nombre: "Ana",
    apellido: "Gómez",
    estado: "ACTIVO",
    esSector: false,
    esTecnico: false,
    permisos: new Set(["preparaciones.confirmar"]),
    ...extra,
  };
}

const credencial = (pin = "4829") => ({ usuarioId: EMPLEADO_ID, prueba: { metodo: "PIN", pin } });

beforeEach(() => {
  auditRecordMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(false);
  loadUsuarioConPermisosMock.mockReset().mockResolvedValue(empleado());
  loadPinEstadoMock.mockReset().mockResolvedValue({ pinHash: "hash", pinBloqueado: false, pinIntentosFallidos: 0 });
  recordPinFailureMock.mockClear();
  resetPinLockoutMock.mockClear();
});

describe("reglas puras", () => {
  it("decideCandidatoOperador: solo una persona ACTIVA del tenant puede ser operador", () => {
    const base = { encontrado: true, estado: "ACTIVO", esSector: false, esTecnico: false };
    expect(decideCandidatoOperador(base)).toBe("OK");
    expect(decideCandidatoOperador({ ...base, encontrado: false, estado: null })).toBe("NO_ENCONTRADO");
    expect(decideCandidatoOperador({ ...base, esSector: true })).toBe("NO_ES_EMPLEADO");
    expect(decideCandidatoOperador({ ...base, esTecnico: true })).toBe("NO_ES_EMPLEADO");
    for (const estado of ["PENDIENTE_ACTIVACION", "SUSPENDIDO", "BAJA"]) {
      expect(decideCandidatoOperador({ ...base, estado })).toBe("INACTIVO");
    }
  });

  it("una cuenta de sector nunca conserva los permisos vedados, aunque su rol los liste", () => {
    const roles = [{ esAdministrador: false, permisos: ["preparaciones.confirmar", "cierres.firmar", "dt.designar", "usuarios.crear", "libro.anulacion.autorizar"] }];
    expect([...permisosEfectivos(roles, true)]).toEqual(["preparaciones.confirmar"]);
    expect(permisosEfectivos(roles, false).has("cierres.firmar")).toBe(true);
    // Not even through the locked ADMINISTRADOR role (INV-SEC-001 forbids the assignment anyway).
    const comoAdmin = permisosEfectivos([{ esAdministrador: true, permisos: [] }], true);
    for (const vedado of PERMISOS_VEDADOS_A_SECTOR) expect(comoAdmin.has(vedado)).toBe(false);
  });

  it("los actos exclusivos del Director Técnico están vedados a una cuenta de sector", () => {
    for (const permiso of ["cierres.firmar", "cierres.folio.corregir", "dt.designar", "dt.cesar", "stock.ajuste.autorizar", "libro.anulacion.autorizar", "libros.crear", "libros.cerrar"]) {
      expect(PERMISOS_VEDADOS_A_SECTOR, permiso).toContain(permiso);
    }
  });

  it("las acciones configurables con PIN son escrituras de roles, nunca vedadas; las activas por defecto son un subconjunto", () => {
    const vedados: readonly string[] = PERMISOS_VEDADOS_A_SECTOR;
    for (const permiso of PERMISOS_CON_PIN_CONFIGURABLES) {
      expect(["operativo", "gestion"], permiso).toContain(PERMISO_CATALOGO[permiso]);
      expect(vedados, permiso).not.toContain(permiso);
    }
    const configurables: readonly string[] = PERMISOS_CON_PIN_CONFIGURABLES;
    for (const permiso of PERMISOS_CON_PIN_POR_DEFECTO) expect(configurables).toContain(permiso);
    // Mostrador stays dynamic by default (user decision 2026-10-13).
    const porDefecto: readonly string[] = PERMISOS_CON_PIN_POR_DEFECTO;
    for (const permiso of ["recetas.crear", "recetas.editar", "entregas.registrar"]) expect(porDefecto).not.toContain(permiso);
  });

  it("fsj.seed_acciones_con_pin (migración 0077) siembra exactamente PERMISOS_CON_PIN_POR_DEFECTO", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../prisma/migrations/20261013150000_0077_cuentas_de_sector/migration.sql"), "utf8");
    const cuerpo = /v_codigos text\[\] := ARRAY\[([\s\S]*?)\];/.exec(sql);
    expect(cuerpo).not.toBeNull();
    const sembrados = [...cuerpo![1]!.matchAll(/'([a-z.]+)'/g)].map((m) => m[1]!);
    expect(sembrados.sort()).toEqual([...PERMISOS_CON_PIN_POR_DEFECTO].sort());
  });
});

describe("verificarOperadorEnTx", () => {
  it("PIN correcto: devuelve al empleado con SUS permisos, reinicia el contador y no audita", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const resultado = await verificarOperadorEnTx(TX, sector, credencial());
    expect(resultado).toEqual({
      ok: true,
      metodo: "PIN",
      operador: { id: EMPLEADO_ID, email: "ana@example.com", nombre: "Ana", apellido: "Gómez", permisos: new Set(["preparaciones.confirmar"]) },
    });
    expect(verifyPasswordMock).toHaveBeenCalledWith("hash", "4829");
    expect(resetPinLockoutMock).toHaveBeenCalledWith(TX, EMPLEADO_ID);
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("PIN incorrecto: no lanza, cuenta el intento y audita el rechazo a nombre de la cuenta de sector", async () => {
    const resultado = await verificarOperadorEnTx(TX, sector, credencial("0000"));
    expect(resultado).toEqual({ ok: false, message: "El PIN no es correcto." });
    expect(recordPinFailureMock).toHaveBeenCalledWith(TX, EMPLEADO_ID, { pinIntentosFallidos: 1, pinBloqueado: false });
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT_ID,
      usuarioId: SECTOR_ID,
      entidad: "operador",
      entidadId: EMPLEADO_ID,
      accion: "AUTORIZAR",
      contexto: { sesionId: "sesion-sector" },
    });
    // The PIN never reaches the audit row.
    expect(JSON.stringify(auditRecordMock.mock.calls[0]![1])).not.toContain("0000");
  });

  it("el intento que alcanza el máximo bloquea el PIN y lo deja dicho en la auditoría", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: "hash", pinBloqueado: false, pinIntentosFallidos: AUTH_POLICY.maxFailedPinAttempts - 1 });
    await verificarOperadorEnTx(TX, sector, credencial("0000"));
    expect(recordPinFailureMock).toHaveBeenCalledWith(TX, EMPLEADO_ID, { pinIntentosFallidos: AUTH_POLICY.maxFailedPinAttempts, pinBloqueado: true });
    expect((auditRecordMock.mock.calls[0]![1] as { motivo: string }).motivo).toContain("PIN bloqueado");
  });

  it("PIN bloqueado: se rechaza aunque coincida, sin sumar intentos", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    loadPinEstadoMock.mockResolvedValue({ pinHash: "hash", pinBloqueado: true, pinIntentosFallidos: 5 });
    const resultado = await verificarOperadorEnTx(TX, sector, credencial());
    expect(resultado.ok).toBe(false);
    expect(resultado).toMatchObject({ message: expect.stringContaining("bloqueado") });
    expect(recordPinFailureMock).not.toHaveBeenCalled();
    expect(resetPinLockoutMock).not.toHaveBeenCalled();
  });

  it("empleado sin PIN configurado: se rechaza con su propio mensaje", async () => {
    loadPinEstadoMock.mockResolvedValue({ pinHash: null, pinBloqueado: false, pinIntentosFallidos: 0 });
    const resultado = await verificarOperadorEnTx(TX, sector, credencial());
    expect(resultado).toMatchObject({ ok: false, message: expect.stringContaining("no tiene un PIN") });
    expect(recordPinFailureMock).not.toHaveBeenCalled();
  });

  it.each([
    ["usuario inexistente", null],
    ["usuario de otra farmacia", empleado({ tenantId: OTRO_TENANT_ID })],
    ["otra cuenta de sector", empleado({ esSector: true })],
    ["el usuario técnico", empleado({ esTecnico: true })],
    ["usuario suspendido", empleado({ estado: "SUSPENDIDO" })],
  ])("%s: mensaje genérico, argon2 corre igual, nunca se lee ni se toca su PIN", async (_caso, candidato) => {
    verifyPasswordMock.mockResolvedValue(true);
    loadUsuarioConPermisosMock.mockResolvedValue(candidato);
    const resultado = await verificarOperadorEnTx(TX, sector, credencial());
    expect(resultado).toEqual({ ok: false, message: MENSAJE_OPERADOR_RECHAZADO });
    // Constant work: a real verification against the dummy hash.
    expect(verifyPasswordMock).toHaveBeenCalledWith(null, "4829");
    expect(loadPinEstadoMock).not.toHaveBeenCalled();
    expect(recordPinFailureMock).not.toHaveBeenCalled();
    expect(resetPinLockoutMock).not.toHaveBeenCalled();
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sin usuario", { prueba: { metodo: "PIN", pin: "4829" } }],
    ["id que no es un UUID", { usuarioId: "ana", prueba: { metodo: "PIN", pin: "4829" } }],
    ["método desconocido", { usuarioId: EMPLEADO_ID, prueba: { metodo: "HUELLA", pin: "4829" } }],
    ["PIN vacío", { usuarioId: EMPLEADO_ID, prueba: { metodo: "PIN", pin: "" } }],
  ])("credencial mal formada (%s): se rechaza sin consultar nada", async (_caso, malFormada) => {
    const resultado = await verificarOperadorEnTx(TX, sector, malFormada);
    expect(resultado).toEqual({ ok: false, message: MENSAJE_OPERADOR_RECHAZADO });
    expect(loadUsuarioConPermisosMock).not.toHaveBeenCalled();
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });
});
