/**
 * Unit tests for `modules/usuarios/application/editar-usuario.ts` (commit 9b2d5db):
 * - For a sector usuario: apellido and dni derived from `nombre` via `identidadDeCuentaDeSector`
 *   (dni "SECTOR-..."), numeroMatricula forced to null, duplicate name -> ValidationError on "nombre".
 * - For a person: empty apellido/dni -> ValidationError on those fields.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ConflictError, ValidationError } from "@/shared/errors";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const loadUsuarioParaAccionMock = vi.fn();
const existeEmailMock = vi.fn(async () => false);
const existeDniMock = vi.fn(async () => false);
const updateUsuarioDatosPersonalesMock = vi.fn(async () => true);

vi.mock("@/modules/usuarios/infrastructure/usuario-repository", () => ({
  loadUsuarioParaAccion: (...args: unknown[]) => loadUsuarioParaAccionMock(...args),
  existeEmail: (...args: unknown[]) => existeEmailMock(...args),
  existeDni: (...args: unknown[]) => existeDniMock(...args),
  updateUsuarioDatosPersonales: (...args: unknown[]) => updateUsuarioDatosPersonalesMock(...args),
}));

const { editarUsuarioCommand } = await import("@/modules/usuarios/application/editar-usuario");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "33333333-3333-4333-a333-333333333333";
const TARGET_ID = "22222222-2222-4222-a222-222222222222";

function fakeSession(): AuthenticatedSession {
  return {
    usuario: { id: ADMIN_ID, email: "admin@example.com", nombre: "A", apellido: "D" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(["usuarios.editar"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

beforeEach(() => {
  auditRecordMock.mockClear();
  existeEmailMock.mockReset().mockResolvedValue(false);
  existeDniMock.mockReset().mockResolvedValue(false);
  updateUsuarioDatosPersonalesMock.mockReset().mockResolvedValue(true);
});

describe("editarUsuario: cuenta de sector", () => {
  const actualSector = {
    id: TARGET_ID,
    estado: "ACTIVO",
    esTecnico: false,
    esSector: true,
    roles: ["FARMACEUTICO"],
    nombre: "Laboratorio",
    apellido: "(Sector)",
    email: "lab@farmacia.local",
    dni: "SECTOR-LABORATORIO",
    numeroMatricula: null,
  };

  beforeEach(() => {
    loadUsuarioParaAccionMock.mockReset().mockResolvedValue(actualSector);
  });

  it("derives apellido and dni from nombre via identidadDeCuentaDeSector, forces matricula to null", async () => {
    await editarUsuarioCommand.execute(
      {
        id: TARGET_ID,
        nombre: "Depósito Central",
        email: "depo@farmacia.local",
        numeroMatricula: "MAT-9999", // should be ignored/forced to null
        version: {
          nombre: "Laboratorio",
          apellido: "(Sector)",
          email: "lab@farmacia.local",
          dni: "SECTOR-LABORATORIO",
          numeroMatricula: null,
        },
      },
      { session: fakeSession() },
    );

    expect(updateUsuarioDatosPersonalesMock).toHaveBeenCalledTimes(1);
    expect(updateUsuarioDatosPersonalesMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        id: TARGET_ID,
        nombre: "Sector",
        apellido: "Depósito Central",
        dni: "SECTOR-DEPOSITO-CENTRAL",
        email: "depo@farmacia.local",
        numeroMatricula: null,
      },
      expect.anything(),
    );
  });

  it("rejects duplicate name with ValidationError on 'nombre' and a sector-specific message", async () => {
    existeDniMock.mockResolvedValue(true);

    const error = await editarUsuarioCommand
      .execute(
        {
          id: TARGET_ID,
          nombre: "Mostrador",
          email: "lab@farmacia.local",
          version: {
            nombre: "Laboratorio",
            apellido: "(Sector)",
            email: "lab@farmacia.local",
            dni: "SECTOR-LABORATORIO",
            numeroMatricula: null,
          },
        },
        { session: fakeSession() },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("Ya existe una cuenta de sector con ese nombre.");
    expect((error as ValidationError).fields).toEqual(["nombre"]);
    expect(updateUsuarioDatosPersonalesMock).not.toHaveBeenCalled();
  });

  it("rejects a sector name that produces no alphanumeric characters", async () => {
    const error = await editarUsuarioCommand
      .execute(
        {
          id: TARGET_ID,
          nombre: "---",
          email: "lab@farmacia.local",
          version: {
            nombre: "Laboratorio",
            apellido: "(Sector)",
            email: "lab@farmacia.local",
            dni: "SECTOR-LABORATORIO",
            numeroMatricula: null,
          },
        },
        { session: fakeSession() },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("El nombre del sector debe tener al menos una letra o un número.");
    expect((error as ValidationError).fields).toEqual(["nombre"]);
    expect(updateUsuarioDatosPersonalesMock).not.toHaveBeenCalled();
  });
});

describe("editarUsuario: person (persona física)", () => {
  const actualPersona = {
    id: TARGET_ID,
    estado: "ACTIVO",
    esTecnico: false,
    esSector: false,
    roles: ["FARMACEUTICO"],
    nombre: "Juan",
    apellido: "Pérez",
    email: "juan@example.com",
    dni: "12345678",
    numeroMatricula: "MP-100",
  };

  beforeEach(() => {
    loadUsuarioParaAccionMock.mockReset().mockResolvedValue(actualPersona);
  });

  it("rejects empty apellido with ValidationError on 'apellido'", async () => {
    const error = await editarUsuarioCommand
      .execute(
        {
          id: TARGET_ID,
          nombre: "Juan",
          apellido: "",
          dni: "12345678",
          email: "juan@example.com",
          version: {
            nombre: "Juan",
            apellido: "Pérez",
            email: "juan@example.com",
            dni: "12345678",
            numeroMatricula: "MP-100",
          },
        },
        { session: fakeSession() },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["apellido"]);
    expect(updateUsuarioDatosPersonalesMock).not.toHaveBeenCalled();
  });

  it("rejects empty dni with ValidationError on 'dni'", async () => {
    const error = await editarUsuarioCommand
      .execute(
        {
          id: TARGET_ID,
          nombre: "Juan",
          apellido: "Pérez",
          dni: "",
          email: "juan@example.com",
          version: {
            nombre: "Juan",
            apellido: "Pérez",
            email: "juan@example.com",
            dni: "12345678",
            numeroMatricula: "MP-100",
          },
        },
        { session: fakeSession() },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["dni"]);
    expect(updateUsuarioDatosPersonalesMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate DNI with ValidationError on 'dni' and person-specific message", async () => {
    existeDniMock.mockResolvedValue(true);

    const error = await editarUsuarioCommand
      .execute(
        {
          id: TARGET_ID,
          nombre: "Juan",
          apellido: "Pérez",
          dni: "87654321",
          email: "juan@example.com",
          version: {
            nombre: "Juan",
            apellido: "Pérez",
            email: "juan@example.com",
            dni: "12345678",
            numeroMatricula: "MP-100",
          },
        },
        { session: fakeSession() },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe("Ya existe un usuario con ese DNI en esta farmacia.");
    expect((error as ValidationError).fields).toEqual(["dni"]);
    expect(updateUsuarioDatosPersonalesMock).not.toHaveBeenCalled();
  });
});
