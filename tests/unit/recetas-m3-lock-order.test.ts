/**
 * M3-discipline unit tests for FASE 6's write commands: lock BEFORE any
 * fresh read that a decision depends on (same discipline as
 * tests/unit/stock-m3-lock-order.test.ts and every other module's
 * lockXParaAccion). Mocked repository/tx, no DB -- tests/db covers the
 * real SQL/trigger shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ConflictError, DomainError, NotFoundError } from "@/shared/errors";

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
const RECETA_ID = "22222222-2222-4222-a222-222222222222";
const PACIENTE_ID = "33333333-3333-4333-a333-333333333333";
const MEDICO_ID = "44444444-4444-4444-a444-444444444444";
const DROGA_ID = "55555555-5555-4555-a555-555555555555";
const UNIDAD_ID = "66666666-6666-4666-a666-666666666666";
const USUARIO_ID = "u-1";

function fakeSession(permiso: string): AuthenticatedSession {
  return {
    usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set([permiso]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const callOrder: string[] = [];

const lockRecetaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("lock");
  return true;
});
const getRecetaParaAccionMock = vi.fn();
const existeFichaConPreparacionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const listItemIdsMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return [] as string[];
});
const getPacienteRefMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: PACIENTE_ID, nombre: "N", apellido: "A", fechaBaja: null };
});
const getMedicoRefMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: MEDICO_ID, nombre: "N", apellido: "A", matricula: "M-1", fechaBaja: null };
});
const drogasInvalidasMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return [] as string[];
});
const unidadesInvalidasMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return [] as string[];
});
const updateRecetaHeaderMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const reemplazarItemsRecetaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const registrarRecepcionFisicaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const anularRecetaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});

vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  lockRecetaParaAccion: (...args: unknown[]) => lockRecetaMock(...args),
  getRecetaParaAccion: (...args: unknown[]) => getRecetaParaAccionMock(...args),
  existeFichaConPreparacionParaReceta: (...args: unknown[]) => existeFichaConPreparacionMock(...args),
  listItemIds: (...args: unknown[]) => listItemIdsMock(...args),
  getPacienteRefParaReceta: (...args: unknown[]) => getPacienteRefMock(...args),
  getMedicoRefParaReceta: (...args: unknown[]) => getMedicoRefMock(...args),
  drogasInvalidas: (...args: unknown[]) => drogasInvalidasMock(...args),
  unidadesInvalidas: (...args: unknown[]) => unidadesInvalidasMock(...args),
  updateRecetaHeader: (...args: unknown[]) => updateRecetaHeaderMock(...args),
  reemplazarItemsReceta: (...args: unknown[]) => reemplazarItemsRecetaMock(...args),
  registrarRecepcionFisica: (...args: unknown[]) => registrarRecepcionFisicaMock(...args),
  anularReceta: (...args: unknown[]) => anularRecetaMock(...args),
}));

const { editarRecetaCommand } = await import("@/modules/recetas/application/editar-receta");
const { registrarRecepcionFisicaCommand } = await import("@/modules/recetas/application/registrar-recepcion-fisica");
const { anularRecetaCommand } = await import("@/modules/recetas/application/anular-receta");

const recetaPendiente = {
  id: RECETA_ID,
  pacienteId: PACIENTE_ID,
  medicoId: MEDICO_ID,
  fechaPrescripcion: new Date("2026-01-01T00:00:00Z"),
  origen: "PRESENCIAL" as const,
  estado: "PENDIENTE_PREPARACION" as const,
  recetaFisicaRecibida: false,
  motivoAnulacion: null,
};

const itemValido = {
  formaFarmaceutica: "CREMA" as const,
  cantidadUnidades: 1,
  fraccionDosisPorUnidad: "1",
  cantidadTotal: null,
  unidadTotalId: null,
  componentes: [{ drogaId: DROGA_ID, cantidad: "5", unidadMedidaId: UNIDAD_ID, modoExpresion: "TOTAL" as const, esPrincipioActivo: true }],
};

function resetMocks() {
  callOrder.length = 0;
  lockRecetaMock.mockClear();
  getRecetaParaAccionMock.mockReset();
  existeFichaConPreparacionMock.mockReset().mockResolvedValue(false);
  listItemIdsMock.mockReset().mockResolvedValue([]);
  getPacienteRefMock.mockReset().mockResolvedValue({ id: PACIENTE_ID, nombre: "N", apellido: "A", fechaBaja: null });
  getMedicoRefMock.mockReset().mockResolvedValue({ id: MEDICO_ID, nombre: "N", apellido: "A", matricula: "M-1", fechaBaja: null });
  drogasInvalidasMock.mockReset().mockResolvedValue([]);
  unidadesInvalidasMock.mockReset().mockResolvedValue([]);
  updateRecetaHeaderMock.mockReset().mockResolvedValue(true);
  reemplazarItemsRecetaMock.mockClear();
  registrarRecepcionFisicaMock.mockClear();
  anularRecetaMock.mockClear();
}

describe("editar-receta: lock BEFORE the fresh estado/version read", () => {
  beforeEach(resetMocks);

  it("locks BEFORE reading, and proceeds when the fresh state is PENDIENTE_PREPARACION with a matching version", async () => {
    getRecetaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return recetaPendiente;
    });

    await editarRecetaCommand.execute(
      {
        id: RECETA_ID,
        pacienteId: PACIENTE_ID,
        medicoId: MEDICO_ID,
        fechaPrescripcion: "2026-01-01",
        origen: "PRESENCIAL",
        items: [itemValido],
        version: { pacienteId: PACIENTE_ID, medicoId: MEDICO_ID, fechaPrescripcion: "2026-01-01", origen: "PRESENCIAL" },
        itemsVersion: [],
      },
      { session: fakeSession("recetas.editar") },
    );

    expect(callOrder).toEqual(["lock", "read"]);
    expect(reemplazarItemsRecetaMock).toHaveBeenCalledTimes(1);
  });

  it("404s when the locked target does not exist (no row to lock) -- never reaches the fresh read", async () => {
    lockRecetaMock.mockImplementationOnce(async () => {
      callOrder.push("lock");
      return false;
    });

    let caught: unknown;
    try {
      await editarRecetaCommand.execute(
        {
          id: RECETA_ID,
          pacienteId: PACIENTE_ID,
          medicoId: MEDICO_ID,
          fechaPrescripcion: "2026-01-01",
          origen: "PRESENCIAL",
          items: [itemValido],
          version: { pacienteId: PACIENTE_ID, medicoId: MEDICO_ID, fechaPrescripcion: "2026-01-01", origen: "PRESENCIAL" },
          itemsVersion: [],
        },
        { session: fakeSession("recetas.editar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(getRecetaParaAccionMock).not.toHaveBeenCalled();
  });

  it("rejects with DomainError when the FRESH estado is no longer PENDIENTE_PREPARACION (6.3 edit lock)", async () => {
    getRecetaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return { ...recetaPendiente, estado: "EN_PREPARACION" as const };
    });

    let caught: unknown;
    try {
      await editarRecetaCommand.execute(
        {
          id: RECETA_ID,
          pacienteId: PACIENTE_ID,
          medicoId: MEDICO_ID,
          fechaPrescripcion: "2026-01-01",
          origen: "PRESENCIAL",
          items: [itemValido],
          version: { pacienteId: PACIENTE_ID, medicoId: MEDICO_ID, fechaPrescripcion: "2026-01-01", origen: "PRESENCIAL" },
          itemsVersion: [],
        },
        { session: fakeSession("recetas.editar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect(callOrder).toEqual(["lock", "read"]);
    expect(reemplazarItemsRecetaMock).not.toHaveBeenCalled();
  });

  it("rejects with DomainError when the receta already has a ficha with a preparación (6.3 edit lock, second half)", async () => {
    getRecetaParaAccionMock.mockResolvedValue(recetaPendiente);
    existeFichaConPreparacionMock.mockResolvedValue(true);

    let caught: unknown;
    try {
      await editarRecetaCommand.execute(
        {
          id: RECETA_ID,
          pacienteId: PACIENTE_ID,
          medicoId: MEDICO_ID,
          fechaPrescripcion: "2026-01-01",
          origen: "PRESENCIAL",
          items: [itemValido],
          version: { pacienteId: PACIENTE_ID, medicoId: MEDICO_ID, fechaPrescripcion: "2026-01-01", origen: "PRESENCIAL" },
          itemsVersion: [],
        },
        { session: fakeSession("recetas.editar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect(reemplazarItemsRecetaMock).not.toHaveBeenCalled();
  });

  it("rejects with ConflictError when the header version does not match the FRESH read (concurrent edit)", async () => {
    getRecetaParaAccionMock.mockResolvedValue(recetaPendiente);

    let caught: unknown;
    try {
      await editarRecetaCommand.execute(
        {
          id: RECETA_ID,
          pacienteId: PACIENTE_ID,
          medicoId: MEDICO_ID,
          fechaPrescripcion: "2026-01-01",
          origen: "PRESENCIAL",
          items: [itemValido],
          version: { pacienteId: PACIENTE_ID, medicoId: MEDICO_ID, fechaPrescripcion: "2020-01-01", origen: "PRESENCIAL" }, // stale version
          itemsVersion: [],
        },
        { session: fakeSession("recetas.editar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    expect(reemplazarItemsRecetaMock).not.toHaveBeenCalled();
  });

  it("rejects with ConflictError when itemsVersion does not match the CURRENT item id set (a concurrent add/remove race)", async () => {
    getRecetaParaAccionMock.mockResolvedValue(recetaPendiente);
    listItemIdsMock.mockResolvedValue(["some-other-item-id"]);

    let caught: unknown;
    try {
      await editarRecetaCommand.execute(
        {
          id: RECETA_ID,
          pacienteId: PACIENTE_ID,
          medicoId: MEDICO_ID,
          fechaPrescripcion: "2026-01-01",
          origen: "PRESENCIAL",
          items: [itemValido],
          version: { pacienteId: PACIENTE_ID, medicoId: MEDICO_ID, fechaPrescripcion: "2026-01-01", origen: "PRESENCIAL" },
          itemsVersion: [], // client thinks there are no existing items
        },
        { session: fakeSession("recetas.editar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    expect(reemplazarItemsRecetaMock).not.toHaveBeenCalled();
  });
});

describe("registrar-recepcion-fisica: lock BEFORE the fresh read, rejects a double registration", () => {
  beforeEach(resetMocks);

  it("locks BEFORE reading, and registers when not already received", async () => {
    getRecetaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return recetaPendiente;
    });

    await registrarRecepcionFisicaCommand.execute({ id: RECETA_ID }, { session: fakeSession("recetas.fisica.registrar") });

    expect(callOrder).toEqual(["lock", "read"]);
    expect(registrarRecepcionFisicaMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, RECETA_ID, USUARIO_ID);
  });

  it("rejects with DomainError when already registered (INV-R09: idempotent-safe, not a silent no-op)", async () => {
    getRecetaParaAccionMock.mockResolvedValue({ ...recetaPendiente, recetaFisicaRecibida: true });

    let caught: unknown;
    try {
      await registrarRecepcionFisicaCommand.execute({ id: RECETA_ID }, { session: fakeSession("recetas.fisica.registrar") });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect(registrarRecepcionFisicaMock).not.toHaveBeenCalled();
  });

  it("404s when the locked target does not exist", async () => {
    lockRecetaMock.mockImplementationOnce(async () => false);

    let caught: unknown;
    try {
      await registrarRecepcionFisicaCommand.execute({ id: RECETA_ID }, { session: fakeSession("recetas.fisica.registrar") });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(getRecetaParaAccionMock).not.toHaveBeenCalled();
  });
});

describe("anular-receta: lock BEFORE the fresh estado read, rejects a terminal estado", () => {
  beforeEach(resetMocks);

  it("locks BEFORE reading, and anula when the fresh estado is non-terminal", async () => {
    getRecetaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return recetaPendiente;
    });

    await anularRecetaCommand.execute({ id: RECETA_ID, motivo: "Paciente no retira." }, { session: fakeSession("recetas.anular") });

    expect(callOrder).toEqual(["lock", "read"]);
    expect(anularRecetaMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, RECETA_ID, "Paciente no retira.");
  });

  it("rejects with DomainError when the FRESH estado is already terminal (ENTREGADA/ANULADA)", async () => {
    getRecetaParaAccionMock.mockResolvedValue({ ...recetaPendiente, estado: "ENTREGADA" as const, recetaFisicaRecibida: true });

    let caught: unknown;
    try {
      await anularRecetaCommand.execute({ id: RECETA_ID, motivo: "x" }, { session: fakeSession("recetas.anular") });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect(anularRecetaMock).not.toHaveBeenCalled();
  });

  it("404s when the locked target does not exist", async () => {
    lockRecetaMock.mockImplementationOnce(async () => false);

    let caught: unknown;
    try {
      await anularRecetaCommand.execute({ id: RECETA_ID, motivo: "x" }, { session: fakeSession("recetas.anular") });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(getRecetaParaAccionMock).not.toHaveBeenCalled();
  });
});
