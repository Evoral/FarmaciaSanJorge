/**
 * Cuentas de sector (openspec/specs/cuentas-de-sector/spec.md): identifying the
 * empleado who acts from a shared session by PIN alone (no user selector).
 *
 *   - pure rules: who may be an operador, what a cuenta de sector can never
 *     hold, which acciones are configurable;
 *   - `loadPinHashesDeOperadores` candidate query: excludes inactive, sector,
 *     technical, users without PIN, and users with a pending password change;
 *   - `verificarOperadorEnTx` with repositories mocked: one match -> ok with
 *     that operador; no match -> NO_RECONOCIDA; two matches -> AMBIGUA;
 *     auditing always targets the cuenta de sector without recording the PIN;
 *     no failed-attempt counter or lockout writes ever; malformed credentials;
 *     and `usuarioId` in the credential ignored.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
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

const loadPinHashesDeOperadoresMock = vi.fn(async (...args: unknown[]): Promise<{ id: string; pinHash: string }[]> => {
  void args;
  return [];
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadPinHashesDeOperadores: (...args: unknown[]) => loadPinHashesDeOperadoresMock(...args),
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
    debeCambiarPassword: false,
    permisos: new Set(["preparaciones.confirmar"]),
    ...extra,
  };
}

const credencial = (pin = "4829") => ({ prueba: { metodo: "PIN" as const, pin } });

beforeEach(() => {
  auditRecordMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(false);
  loadUsuarioConPermisosMock.mockReset().mockResolvedValue(empleado());
  loadPinHashesDeOperadoresMock.mockReset().mockResolvedValue([{ id: EMPLEADO_ID, pinHash: "hash-ana" }]);
});

describe("reglas puras", () => {
  it("decideCandidatoOperador: solo una persona ACTIVA del tenant puede ser operador", () => {
    const base = { encontrado: true, estado: "ACTIVO", esSector: false, esTecnico: false, debeCambiarPassword: false };
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

describe("loadPinHashesDeOperadores (candidate query)", () => {
  it("candidate query excludes debeCambiarPassword/inactive/sector/técnico (assert the findMany where)", async () => {
    const { loadPinHashesDeOperadores } = await vi.importActual<typeof import("@/modules/auth/infrastructure/usuario-repository")>(
      "@/modules/auth/infrastructure/usuario-repository",
    );

    const findMany = vi.fn().mockResolvedValue([
      { id: EMPLEADO_ID, pinHash: "hash-ana" },
      { id: "sin-pin", pinHash: null },
    ]);
    const fakeTx = { usuario: { findMany } } as unknown as Prisma.TransactionClient;

    const result = await loadPinHashesDeOperadores(fakeTx, TENANT_ID);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        estado: "ACTIVO",
        esSector: false,
        esTecnico: false,
        pinHash: { not: null },
        debeCambiarPassword: false,
      },
      select: { id: true, pinHash: true },
    });
    expect(result).toEqual([{ id: EMPLEADO_ID, pinHash: "hash-ana" }]);
  });
});

describe("verificarOperadorEnTx", () => {
  it("PIN correcto con coincidencia única: devuelve al empleado con SUS permisos y no audita", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const resultado = await verificarOperadorEnTx(TX, sector, credencial());
    expect(resultado).toEqual({
      ok: true,
      metodo: "PIN",
      operador: {
        id: EMPLEADO_ID,
        email: "ana@example.com",
        nombre: "Ana",
        apellido: "Gómez",
        permisos: new Set(["preparaciones.confirmar"]),
      },
    });
    expect(verifyPasswordMock).toHaveBeenCalledWith("hash-ana", "4829");
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("sin coincidencia: mensaje NO_RECONOCIDA y audita a nombre de la cuenta de sector sin incluir el PIN", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const resultado = await verificarOperadorEnTx(TX, sector, credencial("0000"));
    expect(resultado).toEqual({
      ok: false,
      message: "El PIN no corresponde a ningún empleado habilitado.",
    });
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT_ID,
      usuarioId: SECTOR_ID,
      entidad: "operador",
      entidadId: SECTOR_ID,
      accion: "AUTORIZAR",
      contexto: { sesionId: "sesion-sector" },
    });
    expect((auditRecordMock.mock.calls[0]![1] as { motivo: string }).motivo).toContain("NO_RECONOCIDA");
    // The PIN never reaches the audit row.
    expect(JSON.stringify(auditRecordMock.mock.calls[0]![1])).not.toContain("0000");
  });

  it("dos coincidencias: mensaje AMBIGUA y audita el rechazo a nombre de la cuenta de sector", async () => {
    loadPinHashesDeOperadoresMock.mockResolvedValue([
      { id: EMPLEADO_ID, pinHash: "hash-1" },
      { id: "44444444-4444-4444-a444-444444444444", pinHash: "hash-2" },
    ]);
    verifyPasswordMock.mockResolvedValue(true);

    const resultado = await verificarOperadorEnTx(TX, sector, credencial());

    expect(resultado).toEqual({
      ok: false,
      message: "Ese PIN lo tiene más de un empleado. Cambialo desde «Mi cuenta» para poder identificarte.",
    });
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT_ID,
      usuarioId: SECTOR_ID,
      entidad: "operador",
      entidadId: SECTOR_ID,
      accion: "AUTORIZAR",
      contexto: { sesionId: "sesion-sector" },
    });
    expect((auditRecordMock.mock.calls[0]![1] as { motivo: string }).motivo).toContain("AMBIGUA");
  });

  it("verifica argon2 contra todos los candidatos sin corte temprano", async () => {
    loadPinHashesDeOperadoresMock.mockResolvedValue([
      { id: EMPLEADO_ID, pinHash: "hash-1" },
      { id: "44444444-4444-4444-a444-444444444444", pinHash: "hash-2" },
      { id: "55555555-5555-4555-a555-555555555555", pinHash: "hash-3" },
    ]);
    // First candidate matches, but all 3 must still be evaluated to detect ambiguity.
    verifyPasswordMock.mockImplementation(async (hash: unknown) => hash === "hash-1");

    const resultado = await verificarOperadorEnTx(TX, sector, credencial());

    expect(resultado.ok).toBe(true);
    expect(verifyPasswordMock).toHaveBeenCalledTimes(3);
    expect(verifyPasswordMock).toHaveBeenCalledWith("hash-1", "4829");
    expect(verifyPasswordMock).toHaveBeenCalledWith("hash-2", "4829");
    expect(verifyPasswordMock).toHaveBeenCalledWith("hash-3", "4829");
  });

  it("nunca escribe contadores ni bloquea el PIN", async () => {
    verifyPasswordMock.mockResolvedValue(false);
    // Multiple failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await verificarOperadorEnTx(TX, sector, credencial("0000"));
      expect(res.ok).toBe(false);
    }
    // TX is not touched with counter updates
    expect(TX).not.toHaveProperty("$executeRaw");
    expect(TX).not.toHaveProperty("$queryRaw");
  });

  it("usuarioId en la credencial es ignorado y se identifica puramente por PIN", async () => {
    verifyPasswordMock.mockResolvedValue(true);
    const credencialConUsuario = {
      usuarioId: "algun-otro-id-o-invalido",
      prueba: { metodo: "PIN" as const, pin: "4829" },
    };

    const resultado = await verificarOperadorEnTx(TX, sector, credencialConUsuario);

    expect(resultado).toEqual({
      ok: true,
      metodo: "PIN",
      operador: {
        id: EMPLEADO_ID,
        email: "ana@example.com",
        nombre: "Ana",
        apellido: "Gómez",
        permisos: new Set(["preparaciones.confirmar"]),
      },
    });
  });

  it.each([
    ["sin prueba", {}],
    ["sin pin", { prueba: { metodo: "PIN" } }],
    ["método desconocido", { prueba: { metodo: "HUELLA", pin: "4829" } }],
    ["PIN vacío", { prueba: { metodo: "PIN", pin: "" } }],
    ["PIN demasiado largo (>64)", { prueba: { metodo: "PIN", pin: "1".repeat(65) } }],
  ])("credencial mal formada (%s): se rechaza con mensaje genérico sin consultar candidatos ni auditar", async (_caso, malFormada) => {
    const resultado = await verificarOperadorEnTx(TX, sector, malFormada);
    expect(resultado).toEqual({ ok: false, message: MENSAJE_OPERADOR_RECHAZADO });
    expect(loadPinHashesDeOperadoresMock).not.toHaveBeenCalled();
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it.each([
    ["usuario no encontrado en loadUsuarioConPermisos", null],
    ["usuario de otra farmacia", empleado({ tenantId: OTRO_TENANT_ID })],
    ["otra cuenta de sector", empleado({ esSector: true })],
    ["el usuario técnico", empleado({ esTecnico: true })],
    ["usuario suspendido", empleado({ estado: "SUSPENDIDO" })],
    ["usuario con cambio de contraseña pendiente", empleado({ debeCambiarPassword: true })],
  ])("re-chequeo de candidato (%s): rechaza con mensaje genérico y audita a nombre de la cuenta de sector", async (_caso, candidato) => {
    verifyPasswordMock.mockResolvedValue(true);
    loadUsuarioConPermisosMock.mockResolvedValue(candidato);

    const resultado = await verificarOperadorEnTx(TX, sector, credencial());

    expect(resultado).toEqual({ ok: false, message: MENSAJE_OPERADOR_RECHAZADO });
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT_ID,
      usuarioId: SECTOR_ID,
      entidad: "operador",
      entidadId: SECTOR_ID,
      accion: "AUTORIZAR",
      contexto: { sesionId: "sesion-sector" },
    });
  });
});
