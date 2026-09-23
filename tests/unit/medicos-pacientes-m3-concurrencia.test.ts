/**
 * M3 (lock-before-read, applied from the start per this task's binding
 * rules) unit regression tests for FASE 4 points 4.4/4.5 (médicos,
 * pacientes). Same shape as tests/unit/catalogos-fase4-m3-concurrencia.test.ts
 * (proveedores/drogas/unidades) -- mocked repository/tx, no DB
 * (tests/db/catalogos-fase4.test.ts and tests/db/catalogos-negocio.test.ts
 * cover the real SQL/trigger shape).
 *
 * Each block proves, for every write command in the module:
 *   1. lock is called BEFORE the fresh read (call order).
 *   2. editar rejects with ConflictError when the LOCKED fresh read shows
 *      the row was given de baja concurrently (after the form was loaded,
 *      before it was submitted) -- the "concurrent-baja-during-edit"
 *      conflict this task calls out explicitly.
 *
 * All `vi.mock`/dynamic imports live at true MODULE top level (not inside
 * `describe`) -- `vi.mock` is only reliably hoisted there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ConflictError } from "@/shared/errors";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
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

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_ID = "22222222-2222-4222-a222-222222222222";

function fakeSession(permiso: string): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set([permiso]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

// ============================================================================
// médicos -- mocks + imports (top level)
// ============================================================================
const medicoCallOrder: string[] = [];
const lockMedicoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  medicoCallOrder.push("lock");
  return true;
});
const getMedicoParaAccionMock = vi.fn();
const existeMatriculaVigenteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const updateMedicoDatosMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const cambiarBajaMedicoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});

vi.mock("@/modules/medicos/infrastructure/medico-repository", () => ({
  lockMedicoParaAccion: (...args: unknown[]) => lockMedicoMock(...args),
  getMedicoParaAccion: (...args: unknown[]) => getMedicoParaAccionMock(...args),
  existeMatriculaVigente: (...args: unknown[]) => existeMatriculaVigenteMock(...args),
  updateMedicoDatos: (...args: unknown[]) => updateMedicoDatosMock(...args),
  cambiarBajaMedico: (...args: unknown[]) => cambiarBajaMedicoMock(...args),
}));

const { editarMedicoCommand } = await import("@/modules/medicos/application/editar-medico");
const { darDeBajaMedicoCommand } = await import("@/modules/medicos/application/dar-de-baja-medico");
const { reactivarMedicoCommand } = await import("@/modules/medicos/application/reactivar-medico");

// ============================================================================
// pacientes -- mocks + imports (top level)
// ============================================================================
const pacienteCallOrder: string[] = [];
const lockPacienteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  pacienteCallOrder.push("lock");
  return true;
});
const getPacienteParaAccionMock = vi.fn();
const existeCuilMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const updatePacienteDatosMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const cambiarBajaPacienteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});

vi.mock("@/modules/pacientes/infrastructure/paciente-repository", () => ({
  lockPacienteParaAccion: (...args: unknown[]) => lockPacienteMock(...args),
  getPacienteParaAccion: (...args: unknown[]) => getPacienteParaAccionMock(...args),
  existeCuil: (...args: unknown[]) => existeCuilMock(...args),
  updatePacienteDatos: (...args: unknown[]) => updatePacienteDatosMock(...args),
  cambiarBajaPaciente: (...args: unknown[]) => cambiarBajaPacienteMock(...args),
}));

const { editarPacienteCommand } = await import("@/modules/pacientes/application/editar-paciente");
const { darDeBajaPacienteCommand } = await import("@/modules/pacientes/application/dar-de-baja-paciente");
const { reactivarPacienteCommand } = await import("@/modules/pacientes/application/reactivar-paciente");

// ============================================================================
// médicos
// ============================================================================
describe("médicos M3: lock-then-fresh-read", () => {
  const vigente = {
    id: TARGET_ID,
    nombre: "N",
    apellido: "A",
    matricula: "MAT-1",
    especialidad: null,
    telefono: null,
    direccionRegistrada: null,
    fechaBaja: null,
    motivoBaja: null,
  };

  beforeEach(() => {
    medicoCallOrder.length = 0;
    lockMedicoMock.mockClear();
    getMedicoParaAccionMock.mockReset();
    existeMatriculaVigenteMock.mockClear();
    updateMedicoDatosMock.mockClear();
    cambiarBajaMedicoMock.mockClear();
  });

  it("editarMedico: rejects the edit when the LOCKED, fresh read shows the médico was given de baja concurrently", async () => {
    getMedicoParaAccionMock.mockImplementation(async () => {
      medicoCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "Jubilación" };
    });

    let caught: unknown;
    try {
      await editarMedicoCommand.execute(
        {
          id: TARGET_ID,
          nombre: "N (renombrado)",
          apellido: "A",
          matricula: "MAT-1",
          version: { nombre: "N", apellido: "A", matricula: "MAT-1", especialidad: null, telefono: null, direccionRegistrada: null },
        },
        { session: fakeSession("medicos.gestionar") },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    expect(medicoCallOrder).toEqual(["lock", "read"]);
    expect(updateMedicoDatosMock).not.toHaveBeenCalled();
  });

  it("editarMedico: locks BEFORE reading, and proceeds when vigente", async () => {
    getMedicoParaAccionMock.mockImplementation(async () => {
      medicoCallOrder.push("read");
      return vigente;
    });

    await editarMedicoCommand.execute(
      {
        id: TARGET_ID,
        nombre: "N (renombrado)",
        apellido: "A",
        matricula: "MAT-1",
        version: { nombre: "N", apellido: "A", matricula: "MAT-1", especialidad: null, telefono: null, direccionRegistrada: null },
      },
      { session: fakeSession("medicos.gestionar") },
    );

    expect(medicoCallOrder).toEqual(["lock", "read"]);
    expect(updateMedicoDatosMock).toHaveBeenCalledTimes(1);
  });

  it("darDeBajaMedico: locks BEFORE reading the current state", async () => {
    getMedicoParaAccionMock.mockImplementation(async () => {
      medicoCallOrder.push("read");
      return vigente;
    });

    await darDeBajaMedicoCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("medicos.gestionar") });

    expect(medicoCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaMedicoMock).toHaveBeenCalledTimes(1);
  });

  it("reactivarMedico: locks BEFORE reading the current state", async () => {
    getMedicoParaAccionMock.mockImplementation(async () => {
      medicoCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "Jubilación" };
    });

    await reactivarMedicoCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("medicos.gestionar") });

    expect(medicoCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaMedicoMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// pacientes
// ============================================================================
describe("pacientes M3: lock-then-fresh-read", () => {
  const vigente = {
    id: TARGET_ID,
    nombre: "N",
    apellido: "A",
    cuil: null,
    dni: null,
    telefono: null,
    email: null,
    fechaNacimiento: null,
    nroCredencial: null,
    sexo: null,
    fechaBaja: null,
    motivoBaja: null,
  };

  beforeEach(() => {
    pacienteCallOrder.length = 0;
    lockPacienteMock.mockClear();
    getPacienteParaAccionMock.mockReset();
    existeCuilMock.mockClear();
    updatePacienteDatosMock.mockClear();
    cambiarBajaPacienteMock.mockClear();
  });

  it("editarPaciente: rejects the edit when the LOCKED, fresh read shows the paciente was given de baja concurrently", async () => {
    getPacienteParaAccionMock.mockImplementation(async () => {
      pacienteCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "Solicitud del paciente" };
    });

    let caught: unknown;
    try {
      await editarPacienteCommand.execute(
        {
          id: TARGET_ID,
          nombre: "N (renombrado)",
          apellido: "A",
          version: { nombre: "N", apellido: "A", cuil: null, dni: null, telefono: null, email: null, fechaNacimiento: null, nroCredencial: null, sexo: null },
        },
        { session: fakeSession("pacientes.gestionar") },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    expect(pacienteCallOrder).toEqual(["lock", "read"]);
    expect(updatePacienteDatosMock).not.toHaveBeenCalled();
  });

  it("editarPaciente: locks BEFORE reading, and proceeds when vigente", async () => {
    getPacienteParaAccionMock.mockImplementation(async () => {
      pacienteCallOrder.push("read");
      return vigente;
    });

    await editarPacienteCommand.execute(
      {
        id: TARGET_ID,
        nombre: "N (renombrado)",
        apellido: "A",
        version: { nombre: "N", apellido: "A", cuil: null, dni: null, telefono: null, email: null, fechaNacimiento: null, nroCredencial: null, sexo: null },
      },
      { session: fakeSession("pacientes.gestionar") },
    );

    expect(pacienteCallOrder).toEqual(["lock", "read"]);
    expect(updatePacienteDatosMock).toHaveBeenCalledTimes(1);
  });

  it("darDeBajaPaciente: locks BEFORE reading the current state", async () => {
    getPacienteParaAccionMock.mockImplementation(async () => {
      pacienteCallOrder.push("read");
      return vigente;
    });

    await darDeBajaPacienteCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("pacientes.gestionar") });

    expect(pacienteCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaPacienteMock).toHaveBeenCalledTimes(1);
  });

  it("reactivarPaciente: locks BEFORE reading the current state", async () => {
    getPacienteParaAccionMock.mockImplementation(async () => {
      pacienteCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "Solicitud del paciente" };
    });

    await reactivarPacienteCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("pacientes.gestionar") });

    expect(pacienteCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaPacienteMock).toHaveBeenCalledTimes(1);
  });
});
