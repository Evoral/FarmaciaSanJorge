/**
 * Consent for WhatsApp reminders (`paciente.acepta_recordatorios_whatsapp`,
 * docs/specs/pacientes-recurrentes.md) through the crear/editar use cases:
 * it is persisted, audited like every other field (valorAnterior/valorNuevo),
 * takes part in the optimistic-concurrency check, and an omitted value can never
 * silently revoke a consent. Repository mocked, no DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ConflictError } from "@/shared/errors";

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
vi.mock("@/modules/pacientes/infrastructure/paciente-repository", () => ({
  insertPaciente: (...args: unknown[]) => insertPacienteMock(...args),
  existeCuil: vi.fn(async () => false),
  lockPacienteParaAccion: vi.fn(async () => true),
  getPacienteParaAccion: (...args: unknown[]) => getPacienteParaAccionMock(...args),
  updatePacienteDatos: (...args: unknown[]) => updatePacienteDatosMock(...args),
  cambiarBajaPaciente: vi.fn(),
}));

const { crearPacienteCommand } = await import("@/modules/pacientes/application/crear-paciente");
const { editarPacienteCommand } = await import("@/modules/pacientes/application/editar-paciente");

const TARGET_ID = "22222222-2222-4222-a222-222222222222";
const session: AuthenticatedSession = {
  usuario: { id: "u1", email: "a@example.com", nombre: "N", apellido: "A" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(["pacientes.gestionar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

const VERSION_BASE = { nombre: "N", apellido: "A", cuil: null, dni: null, telefono: null, email: null, fechaNacimiento: null, nroCredencial: null, sexo: null };
const actual = (acepta: boolean) => ({ id: TARGET_ID, ...VERSION_BASE, fechaNacimiento: null, aceptaRecordatoriosWhatsapp: acepta, fechaBaja: null, motivoBaja: null });
const edicion = (over: Record<string, unknown> = {}) => ({
  id: TARGET_ID,
  nombre: "N",
  apellido: "A",
  aceptaRecordatoriosWhatsapp: true,
  version: { ...VERSION_BASE, aceptaRecordatoriosWhatsapp: false },
  ...over,
});

beforeEach(() => {
  auditRecordMock.mockClear();
  insertPacienteMock.mockClear();
  getPacienteParaAccionMock.mockReset();
  updatePacienteDatosMock.mockClear();
});

describe("crearPaciente -- consent", () => {
  it("defaults to NO consent when the field is absent", async () => {
    await crearPacienteCommand.execute({ nombre: "N", apellido: "A" }, { session });
    expect(insertPacienteMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ aceptaRecordatoriosWhatsapp: false }));
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ accion: "CREAR", valorNuevo: { aceptaRecordatoriosWhatsapp: false } });
  });

  it("persists and audits an explicit acceptance", async () => {
    await crearPacienteCommand.execute({ nombre: "N", apellido: "A", aceptaRecordatoriosWhatsapp: true }, { session });
    expect(insertPacienteMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ aceptaRecordatoriosWhatsapp: true }));
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ valorNuevo: { aceptaRecordatoriosWhatsapp: true } });
  });

  it("rejects a non-boolean value", async () => {
    await expect(crearPacienteCommand.execute({ nombre: "N", apellido: "A", aceptaRecordatoriosWhatsapp: "on" }, { session })).rejects.toThrow(/Datos inválidos/);
    expect(insertPacienteMock).not.toHaveBeenCalled();
  });
});

describe("editarPaciente -- consent", () => {
  it("writes the new value and audits the change in valorAnterior / valorNuevo", async () => {
    getPacienteParaAccionMock.mockResolvedValue(actual(false));
    await editarPacienteCommand.execute(edicion(), { session });

    expect(updatePacienteDatosMock).toHaveBeenCalledTimes(1);
    const [, , nuevo, anterior] = updatePacienteDatosMock.mock.calls[0] as unknown as [unknown, string, { aceptaRecordatoriosWhatsapp: boolean }, { aceptaRecordatoriosWhatsapp: boolean }];
    expect(nuevo.aceptaRecordatoriosWhatsapp).toBe(true);
    expect(anterior.aceptaRecordatoriosWhatsapp).toBe(false); // the CAS version sent to the repository's WHERE
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({
      accion: "MODIFICAR",
      valorAnterior: { aceptaRecordatoriosWhatsapp: false },
      valorNuevo: { aceptaRecordatoriosWhatsapp: true },
    });
  });

  it("can revoke a consent (true -> false) and audits it", async () => {
    getPacienteParaAccionMock.mockResolvedValue(actual(true));
    await editarPacienteCommand.execute(edicion({ aceptaRecordatoriosWhatsapp: false, version: { ...VERSION_BASE, aceptaRecordatoriosWhatsapp: true } }), { session });
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({
      valorAnterior: { aceptaRecordatoriosWhatsapp: true },
      valorNuevo: { aceptaRecordatoriosWhatsapp: false },
    });
  });

  it("optimistic concurrency: a consent changed by someone else since the form was loaded is a conflict", async () => {
    getPacienteParaAccionMock.mockResolvedValue(actual(true)); // someone else accepted meanwhile; the form still says false
    await expect(editarPacienteCommand.execute(edicion(), { session })).rejects.toBeInstanceOf(ConflictError);
    expect(updatePacienteDatosMock).not.toHaveBeenCalled();
  });

  it("an unchanged consent does not conflict", async () => {
    getPacienteParaAccionMock.mockResolvedValue(actual(false));
    await expect(editarPacienteCommand.execute(edicion({ aceptaRecordatoriosWhatsapp: false }), { session })).resolves.toEqual({ id: TARGET_ID });
  });

  it("the value is required (no default): an omitted field must never silently revoke a consent", async () => {
    const { aceptaRecordatoriosWhatsapp: _omitido, ...sinCampo } = edicion();
    void _omitido;
    await expect(editarPacienteCommand.execute(sinCampo, { session })).rejects.toThrow(/Datos inválidos/);
    expect(updatePacienteDatosMock).not.toHaveBeenCalled();

    await expect(editarPacienteCommand.execute(edicion({ version: VERSION_BASE }), { session })).rejects.toThrow(/Datos inválidos/);
  });
});

describe("crearPaciente -- consent cannot be recorded through the receta flow", () => {
  const sessionRecetas: AuthenticatedSession = { ...session, permisos: new Set(["recetas.crear"]) as AuthenticatedSession["permisos"] };

  it("crearPacienteInput (shared with the receta PDF import) strips the consent key: the exported shape has no such field", async () => {
    const { crearPacienteInput } = await import("@/modules/pacientes/application/crear-paciente");
    expect("aceptaRecordatoriosWhatsapp" in crearPacienteInput.shape).toBe(false);
    const parsed = crearPacienteInput.parse({ nombre: "N", apellido: "A", aceptaRecordatoriosWhatsapp: true });
    expect(parsed).not.toHaveProperty("aceptaRecordatoriosWhatsapp");
  });

  it("pacientes.crear-desde-receta persists FALSE even when the payload says true", async () => {
    const { crearPacienteDesdeRecetaCommand } = await import("@/modules/pacientes/application/crear-paciente-desde-receta");
    await crearPacienteDesdeRecetaCommand.execute({ nombre: "N", apellido: "A", aceptaRecordatoriosWhatsapp: true }, { session: sessionRecetas });
    expect(insertPacienteMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ aceptaRecordatoriosWhatsapp: false }));
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ valorNuevo: { aceptaRecordatoriosWhatsapp: false } });
  });

  it("the shared handler (used by desde-receta and the PDF import) stores false even if a caller hands it a true by mistake", async () => {
    const { crearPacienteHandler } = await import("@/modules/pacientes/application/crear-paciente");
    const input = { nombre: "N", apellido: "A", cuil: null, dni: null, telefono: null, email: null, fechaNacimiento: null, nroCredencial: null, sexo: null, aceptaRecordatoriosWhatsapp: true };
    const resultado = await crearPacienteHandler({ tx: {} as never, session, input });
    expect(insertPacienteMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ aceptaRecordatoriosWhatsapp: false }));
    expect(resultado.audit?.valorNuevo).toMatchObject({ aceptaRecordatoriosWhatsapp: false });
  });

  it("only pacientes.crear (permiso pacientes.gestionar) can persist true", async () => {
    await crearPacienteCommand.execute({ nombre: "N", apellido: "A", aceptaRecordatoriosWhatsapp: true }, { session });
    expect(insertPacienteMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ aceptaRecordatoriosWhatsapp: true }));
  });
});
