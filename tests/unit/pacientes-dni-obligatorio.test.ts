import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ValidationError } from "@/shared/errors";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
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

const insertPacienteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "33333333-3333-4333-8333-333333333333" };
});
const getPacienteParaAccionMock = vi.fn();
const updatePacienteDatosMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const existeCuilMock = vi.fn(async (..._args: unknown[]) => {
  void _args;
  return false;
});
const existeDniMock = vi.fn(async (..._args: unknown[]) => {
  void _args;
  return false;
});

vi.mock("@/modules/pacientes/infrastructure/paciente-repository", () => ({
  insertPaciente: (...args: unknown[]) => insertPacienteMock(...args),
  existeCuil: (...args: unknown[]) => existeCuilMock(...args),
  existeDni: (...args: unknown[]) => existeDniMock(...args),
  lockPacienteParaAccion: vi.fn(async () => true),
  getPacienteParaAccion: (...args: unknown[]) => getPacienteParaAccionMock(...args),
  updatePacienteDatos: (...args: unknown[]) => updatePacienteDatosMock(...args),
  cambiarBajaPaciente: vi.fn(),
}));

const { crearPacienteCommand } = await import("@/modules/pacientes/application/crear-paciente");
const { crearPacienteDesdeRecetaCommand } = await import("@/modules/pacientes/application/crear-paciente-desde-receta");
const { editarPacienteCommand } = await import("@/modules/pacientes/application/editar-paciente");

const TARGET_ID = "22222222-2222-4222-a222-222222222222";
const sessionGestionar: AuthenticatedSession = {
  usuario: { id: "u1", email: "a@example.com", nombre: "N", apellido: "A" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(["pacientes.gestionar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};
const sessionRecetas: AuthenticatedSession = {
  ...sessionGestionar,
  permisos: new Set(["recetas.crear"]) as AuthenticatedSession["permisos"],
};

beforeEach(() => {
  auditRecordMock.mockClear();
  insertPacienteMock.mockClear();
  getPacienteParaAccionMock.mockReset();
  updatePacienteDatosMock.mockClear();
  existeCuilMock.mockReset().mockResolvedValue(false);
  existeDniMock.mockReset().mockResolvedValue(false);
});

describe("Paciente use cases: DNI obligatorio rule", () => {
  describe("alta: crearPacienteCommand & crearPacienteDesdeRecetaCommand", () => {
    it("crearPacienteCommand without DNI fails with ValidationError on field 'dni'", async () => {
      const error = await crearPacienteCommand
        .execute({ nombre: "Juan", apellido: "Pérez" } as never, { session: sessionGestionar })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("Ingresá el DNI del paciente.");
      expect((error as ValidationError).fields).toEqual(["dni"]);
      expect(insertPacienteMock).not.toHaveBeenCalled();
    });

    it("crearPacienteDesdeRecetaCommand without DNI fails with ValidationError on field 'dni'", async () => {
      const error = await crearPacienteDesdeRecetaCommand
        .execute({ nombre: "Juan", apellido: "Pérez" } as never, { session: sessionRecetas })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("Ingresá el DNI del paciente.");
      expect((error as ValidationError).fields).toEqual(["dni"]);
      expect(insertPacienteMock).not.toHaveBeenCalled();
    });

    it("alta fails with 'Ya existe un paciente con ese DNI.' and fields ['dni'] if DNI is already used", async () => {
      existeDniMock.mockResolvedValue(true);

      const error = await crearPacienteCommand
        .execute({ nombre: "Juan", apellido: "Pérez", dni: "30123456" }, { session: sessionGestionar })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Ya existe un paciente con ese DNI.");
      expect((error as ValidationError).fields).toEqual(["dni"]);
      expect(insertPacienteMock).not.toHaveBeenCalled();
    });
  });

  describe("edición: editarPacienteCommand", () => {
    const baseActual = {
      id: TARGET_ID,
      nombre: "Juan",
      apellido: "Pérez",
      cuil: null,
      dni: "12345678",
      telefono: null,
      email: null,
      fechaNacimiento: null,
      nroCredencial: null,
      sexo: null,
      fechaBaja: null,
      motivoBaja: null,
      aceptaRecordatoriosWhatsapp: false,
      domicilio: null,
      domicilioEntrega: null,
    };

    const edicionPayload = (dniInput: string | null | undefined, versionDni: string | null = "12345678") => ({
      id: TARGET_ID,
      nombre: "Juan",
      apellido: "Pérez",
      dni: dniInput,
      aceptaRecordatoriosWhatsapp: false,
      version: {
        nombre: "Juan",
        apellido: "Pérez",
        cuil: null,
        dni: versionDni,
        telefono: null,
        email: null,
        fechaNacimiento: null,
        nroCredencial: null,
        sexo: null,
        aceptaRecordatoriosWhatsapp: false,
        domicilio: null,
        domicilioEntrega: null,
      },
    });

    it("a paciente that already has a DNI can change it to another valid one", async () => {
      getPacienteParaAccionMock.mockResolvedValue(baseActual);

      await editarPacienteCommand.execute(edicionPayload("87654321"), { session: sessionGestionar });

      expect(updatePacienteDatosMock).toHaveBeenCalledTimes(1);
      expect(updatePacienteDatosMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ id: TARGET_ID, dni: "87654321" }),
        expect.objectContaining({ dni: "12345678" }),
      );
    });

    it("a paciente with a DNI throws 'Ingresá el DNI del paciente.' with fields ['dni'] when sending it empty", async () => {
      getPacienteParaAccionMock.mockResolvedValue(baseActual);

      const error = await editarPacienteCommand
        .execute(edicionPayload(""), { session: sessionGestionar })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Ingresá el DNI del paciente.");
      expect((error as ValidationError).fields).toEqual(["dni"]);
      expect(updatePacienteDatosMock).not.toHaveBeenCalled();
    });

    it("a paciente stored WITHOUT a DNI can still be saved without one (legacy rows)", async () => {
      const legacyActual = { ...baseActual, dni: null };
      getPacienteParaAccionMock.mockResolvedValue(legacyActual);

      await editarPacienteCommand.execute(edicionPayload(null, null), { session: sessionGestionar });

      expect(updatePacienteDatosMock).toHaveBeenCalledTimes(1);
      expect(updatePacienteDatosMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ id: TARGET_ID, dni: null }),
        expect.objectContaining({ dni: null }),
      );
    });

    it("edición fails with 'Ya existe un paciente con ese DNI.' and fields ['dni'] if DNI is already used by another paciente", async () => {
      getPacienteParaAccionMock.mockResolvedValue(baseActual);
      existeDniMock.mockResolvedValue(true);

      const error = await editarPacienteCommand
        .execute(edicionPayload("30123456"), { session: sessionGestionar })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Ya existe un paciente con ese DNI.");
      expect((error as ValidationError).fields).toEqual(["dni"]);
      expect(updatePacienteDatosMock).not.toHaveBeenCalled();
    });
  });
});
