/**
 * Cuentas de sector (docs/specs/cuentas-de-sector.md): creating one from
 * `/admin/accesos/usuarios/nuevo`. A sector is a work area, not a person:
 * the administrator types its name and its login email, nothing else --
 * apellido and DNI are derived, a person still needs both.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ValidationError } from "@/shared/errors";
import { identidadDeCuentaDeSector } from "@/modules/usuarios/domain/cuenta-de-sector";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const insertUsuarioMock = vi.fn(async (...args: unknown[]): Promise<{ id: string }> => {
  void args;
  return { id: "nuevo-usuario-1" };
});
const existeDniMock = vi.fn(async (...args: unknown[]): Promise<boolean> => {
  void args;
  return false;
});
vi.mock("@/modules/usuarios/infrastructure/usuario-repository", () => ({
  existeEmail: vi.fn(async () => false),
  existeDni: (...args: unknown[]) => existeDniMock(...args),
  insertUsuario: (...args: unknown[]) => insertUsuarioMock(...args),
  insertUsuarioRol: vi.fn(async () => undefined),
}));

vi.mock("@/modules/usuarios/infrastructure/rol-repository", () => ({
  findRolesPorCodigo: vi.fn(async (_tx: unknown, _tenantId: string, codigos: string[]) =>
    codigos.map((codigo) => ({ id: `rol-${codigo}`, codigo, nombre: codigo, esAdministrador: codigo === "ADMINISTRADOR", permisos: [] })),
  ),
  codigosDeRolesDelUsuario: vi.fn(async () => ["ADMINISTRADOR"]),
}));

const { crearUsuarioCommand } = await import("@/modules/usuarios/application/crear-usuario");

const admin: AuthenticatedSession = {
  usuario: { id: "admin-1", email: "admin@example.com", nombre: "A", apellido: "D" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(["usuarios.crear"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

beforeEach(() => {
  insertUsuarioMock.mockClear();
  existeDniMock.mockReset().mockResolvedValue(false);
});

const passwordTemporal = { passwordTemporal: "Temporal-Segura-2026", passwordTemporalRepeat: "Temporal-Segura-2026" };

describe("identidadDeCuentaDeSector", () => {
  it("deriva nombre, apellido y un DNI estable a partir del nombre del sector", () => {
    expect(identidadDeCuentaDeSector("Laboratorio")).toEqual({ nombre: "Sector", apellido: "Laboratorio", dni: "SECTOR-LABORATORIO" });
    expect(identidadDeCuentaDeSector("  Mostrador   1 ")).toEqual({ nombre: "Sector", apellido: "Mostrador 1", dni: "SECTOR-MOSTRADOR-1" });
    // Accents and case never make two sectors "different".
    expect(identidadDeCuentaDeSector("Elaboración")!.dni).toBe(identidadDeCuentaDeSector("ELABORACION")!.dni);
  });

  it("un nombre sin letras ni números no sirve", () => {
    expect(identidadDeCuentaDeSector("¿?")).toBeNull();
    expect(identidadDeCuentaDeSector("   ")).toBeNull();
  });
});

describe("crearUsuario: cuenta de sector", () => {
  it("alcanza con el nombre del sector, el email y un rol: apellido y DNI se derivan, sin matrícula", async () => {
    await crearUsuarioCommand.execute(
      { nombre: "Laboratorio", apellido: "", dni: "", email: "laboratorio@farmacia.local", numeroMatricula: "MP 123", roles: ["LABORATORIO"], esSector: true, ...passwordTemporal },
      { session: admin },
    );
    expect(insertUsuarioMock).toHaveBeenCalledTimes(1);
    expect(insertUsuarioMock.mock.calls[0]![1]).toMatchObject({
      nombre: "Sector",
      apellido: "Laboratorio",
      dni: "SECTOR-LABORATORIO",
      email: "laboratorio@farmacia.local",
      numeroMatricula: null,
      esSector: true,
    });
  });

  it("dos cuentas de sector con el mismo nombre: se rechaza marcando el nombre", async () => {
    existeDniMock.mockResolvedValue(true);
    const error = await crearUsuarioCommand
      .execute({ nombre: "Laboratorio", email: "lab2@farmacia.local", roles: ["LABORATORIO"], esSector: true, ...passwordTemporal }, { session: admin })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("Ya existe una cuenta de sector con ese nombre.");
    expect((error as ValidationError).fields).toEqual(["nombre"]);
    expect(existeDniMock).toHaveBeenCalledWith(expect.anything(), admin.tenantId, "SECTOR-LABORATORIO");
    expect(insertUsuarioMock).not.toHaveBeenCalled();
  });

  it.each(["ADMINISTRADOR", "DIRECTOR_TECNICO"])("no admite el rol %s", async (rol) => {
    await expect(
      crearUsuarioCommand.execute({ nombre: "Laboratorio", email: "lab@farmacia.local", roles: ["LABORATORIO", rol], esSector: true, ...passwordTemporal }, { session: admin }),
    ).rejects.toThrow(/cuenta de sector no puede tener el rol/);
    expect(insertUsuarioMock).not.toHaveBeenCalled();
  });
});

describe("crearUsuario: una persona sigue necesitando apellido y DNI", () => {
  it("sin apellido ni DNI se rechaza, nombrando los dos campos", async () => {
    const error = await crearUsuarioCommand
      .execute({ nombre: "Ana", apellido: "", dni: "  ", email: "ana@example.com", roles: ["FARMACEUTICO"], ...passwordTemporal }, { session: admin })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["apellido", "dni"]);
    expect(insertUsuarioMock).not.toHaveBeenCalled();
  });

  it("con todos sus datos se crea tal cual", async () => {
    await crearUsuarioCommand.execute({ nombre: "Ana", apellido: "Gómez", dni: "30111222", email: "ana@example.com", roles: ["FARMACEUTICO"], ...passwordTemporal }, { session: admin });
    expect(insertUsuarioMock.mock.calls[0]![1]).toMatchObject({ nombre: "Ana", apellido: "Gómez", dni: "30111222", esSector: false });
  });
});
