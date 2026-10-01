/**
 * Server Actions of `/pacientes`: an unchecked checkbox is NOT submitted by the
 * browser, so the actions must turn its absence into an explicit `false`
 * (and read the hidden `version*` copy as "true"/"false"). Use cases mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const crearPacienteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "x" };
});
const editarPacienteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "x" };
});
vi.mock("@/modules/pacientes/application/crear-paciente", () => ({ crearPaciente: (...args: unknown[]) => crearPacienteMock(...args) }));
vi.mock("@/modules/pacientes/application/editar-paciente", () => ({ editarPaciente: (...args: unknown[]) => editarPacienteMock(...args) }));
vi.mock("@/modules/pacientes/application/dar-de-baja-paciente", () => ({ darDeBajaPaciente: vi.fn() }));
vi.mock("@/modules/pacientes/application/reactivar-paciente", () => ({ reactivarPaciente: vi.fn() }));

const { crearPacienteAction, editarPacienteAction } = await import("@/modules/pacientes/ui/actions");

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

const BASE = { id: "22222222-2222-4222-a222-222222222222", nombre: "N", apellido: "A", versionNombre: "N", versionApellido: "A" };

beforeEach(() => {
  crearPacienteMock.mockClear();
  editarPacienteMock.mockClear();
});

describe("crearPacienteAction", () => {
  it("sends false when the checkbox is absent (unchecked)", async () => {
    await crearPacienteAction({ status: "idle" }, form({ nombre: "N", apellido: "A" }));
    expect(crearPacienteMock).toHaveBeenCalledWith(expect.objectContaining({ aceptaRecordatoriosWhatsapp: false }));
  });

  it("sends true when the checkbox is checked", async () => {
    await crearPacienteAction({ status: "idle" }, form({ nombre: "N", apellido: "A", aceptaRecordatoriosWhatsapp: "on" }));
    expect(crearPacienteMock).toHaveBeenCalledWith(expect.objectContaining({ aceptaRecordatoriosWhatsapp: true }));
  });
});

describe("editarPacienteAction", () => {
  it("unchecked checkbox -> false, and the hidden version copy is read as a boolean", async () => {
    await editarPacienteAction({ status: "idle" }, form({ ...BASE, versionAceptaRecordatoriosWhatsapp: "true" }));
    expect(editarPacienteMock).toHaveBeenCalledWith(
      expect.objectContaining({ aceptaRecordatoriosWhatsapp: false, version: expect.objectContaining({ aceptaRecordatoriosWhatsapp: true }) }),
    );
  });

  it("checked checkbox -> true; a 'false' (or missing) version copy -> false", async () => {
    await editarPacienteAction({ status: "idle" }, form({ ...BASE, aceptaRecordatoriosWhatsapp: "on", versionAceptaRecordatoriosWhatsapp: "false" }));
    expect(editarPacienteMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ aceptaRecordatoriosWhatsapp: true, version: expect.objectContaining({ aceptaRecordatoriosWhatsapp: false }) }),
    );
    await editarPacienteAction({ status: "idle" }, form({ ...BASE }));
    expect(editarPacienteMock).toHaveBeenLastCalledWith(expect.objectContaining({ version: expect.objectContaining({ aceptaRecordatoriosWhatsapp: false }) }));
  });
});
