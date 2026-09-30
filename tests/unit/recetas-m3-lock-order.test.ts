/**
 * M3-discipline unit tests for FASE 6's write commands: lock BEFORE any
 * fresh read that a decision depends on (same discipline as
 * tests/unit/stock-m3-lock-order.test.ts and every other module's
 * lockXParaAccion). Mocked repository/tx, no DB -- tests/db covers the
 * real SQL/trigger shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/shared/errors";

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
const itemsConPreparacionIniciadaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return [] as string[];
});
const asientosEnEfectoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return [] as { itemRecetaId: string; asientoId: string; numeroCorrelativo: string }[];
});
vi.mock("@/modules/libro/application/asientos-en-efecto", () => ({
  listAsientosEnEfectoDeReceta: (...args: unknown[]) => asientosEnEfectoMock(...args),
}));
const itemsConFichaOCotizacionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return new Set<string>();
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
  itemsConFichaOCotizacion: (...args: unknown[]) => itemsConFichaOCotizacionMock(...args),
  itemsConPreparacionIniciada: (...args: unknown[]) => itemsConPreparacionIniciadaMock(...args),
  getPacienteRefParaReceta: (...args: unknown[]) => getPacienteRefMock(...args),
  getMedicoRefParaReceta: (...args: unknown[]) => getMedicoRefMock(...args),
  drogasInvalidas: (...args: unknown[]) => drogasInvalidasMock(...args),
  unidadesInvalidas: (...args: unknown[]) => unidadesInvalidasMock(...args),
  getNombresParaResumen: async () => ({ drogas: new Map<string, string>(), unidades: new Map<string, string>() }),
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
  diagnosticoCodigo: null,
  diagnosticoDescripcion: null,
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
  itemsConFichaOCotizacionMock.mockReset().mockResolvedValue(new Set<string>());
  itemsConPreparacionIniciadaMock.mockReset().mockResolvedValue([]);
  asientosEnEfectoMock.mockReset().mockResolvedValue([]);
  reemplazarItemsRecetaMock.mockClear();
  registrarRecepcionFisicaMock.mockClear();
  anularRecetaMock.mockClear();
}

// Item removal vs. fichas (docs/specs/presupuesto-receta.md, "Edición"): an item with a ficha
// técnica (or cotización) cannot be removed; editing its content still can.
describe("editar-receta: items that already have a ficha técnica", () => {
  beforeEach(resetMocks);

  const ITEM_1 = "55555555-5555-4555-a555-555555555555";
  const ITEM_2 = "66666666-6666-4666-a666-666666666666";

  function editar(items: unknown[]) {
    return editarRecetaCommand.execute(
      {
        id: RECETA_ID,
        pacienteId: PACIENTE_ID,
        medicoId: MEDICO_ID,
        fechaPrescripcion: "2026-01-01",
        origen: "PRESENCIAL",
        items,
        version: { pacienteId: PACIENTE_ID, medicoId: MEDICO_ID, fechaPrescripcion: "2026-01-01", origen: "PRESENCIAL" },
        itemsVersion: [ITEM_1, ITEM_2],
      },
      { session: fakeSession("recetas.editar") },
    );
  }

  it("refuses to remove an item that has a ficha, naming it by its position, and changes nothing", async () => {
    getRecetaParaAccionMock.mockResolvedValue(recetaPendiente);
    listItemIdsMock.mockResolvedValue([ITEM_1, ITEM_2]);
    itemsConFichaOCotizacionMock.mockResolvedValue(new Set([ITEM_2]));

    await expect(editar([{ ...itemValido, id: ITEM_1 }])).rejects.toThrow(
      new ValidationError("No se puede quitar el ítem 2 porque ya tiene ficha técnica. Si la receta se cargó mal, anulala y cargala de nuevo."),
    );
    expect(itemsConFichaOCotizacionMock).toHaveBeenCalledWith(expect.anything(), expect.any(String), [ITEM_2]);
    expect(updateRecetaHeaderMock).not.toHaveBeenCalled();
    expect(reemplazarItemsRecetaMock).not.toHaveBeenCalled();
  });

  it("still allows editing the content of items that have a ficha (none removed)", async () => {
    getRecetaParaAccionMock.mockResolvedValue(recetaPendiente);
    listItemIdsMock.mockResolvedValue([ITEM_1, ITEM_2]);
    itemsConFichaOCotizacionMock.mockResolvedValue(new Set([ITEM_1, ITEM_2]));

    await editar([
      { ...itemValido, id: ITEM_1, cantidadUnidades: 2 },
      { ...itemValido, id: ITEM_2, fraccionDosisPorUnidad: "0.5" },
    ]);
    expect(itemsConFichaOCotizacionMock).not.toHaveBeenCalled();
    expect(reemplazarItemsRecetaMock).toHaveBeenCalledTimes(1);
  });

  it("allows removing an item without a ficha", async () => {
    getRecetaParaAccionMock.mockResolvedValue(recetaPendiente);
    listItemIdsMock.mockResolvedValue([ITEM_1, ITEM_2]);
    itemsConFichaOCotizacionMock.mockResolvedValue(new Set());

    await editar([{ ...itemValido, id: ITEM_1 }]);
    expect(reemplazarItemsRecetaMock).toHaveBeenCalledTimes(1);
  });
});

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

// Direct anulación vs. the libro recetario (modules/recetas/domain/anulacion.ts).
describe("anular-receta: refused while the libro still records a preparación", () => {
  beforeEach(resetMocks);

  const ITEM_1 = "55555555-5555-4555-a555-555555555555";
  const ITEM_2 = "66666666-6666-4666-a666-666666666666";

  it("refuses when an item's SISTEMA asiento is still in effect, and anulls nothing", async () => {
    getRecetaParaAccionMock.mockResolvedValue({ ...recetaPendiente, estado: "LISTA_PARA_RETIRAR" as const });
    listItemIdsMock.mockResolvedValue([ITEM_1, ITEM_2]);
    asientosEnEfectoMock.mockResolvedValue([{ itemRecetaId: ITEM_2, asientoId: "a-1", numeroCorrelativo: "15" }]);

    await expect(anularRecetaCommand.execute({ id: RECETA_ID, motivo: "x" }, { session: fakeSession("recetas.anular") })).rejects.toThrow(
      new ValidationError(
        "Esta receta ya tiene preparaciones registradas en el libro recetario. Para anularla, dejá sin efecto esos asientos desde el Libro recetario (requiere autorización del Director Técnico). La receta se anulará automáticamente.",
      ),
    );
    expect(asientosEnEfectoMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, RECETA_ID);
    expect(anularRecetaMock).not.toHaveBeenCalled();
  });

  it("allows it with no preparación at all", async () => {
    getRecetaParaAccionMock.mockResolvedValue(recetaPendiente);
    listItemIdsMock.mockResolvedValue([ITEM_1]);
    await anularRecetaCommand.execute({ id: RECETA_ID, motivo: "x" }, { session: fakeSession("recetas.anular") });
    expect(anularRecetaMock).toHaveBeenCalledTimes(1);
  });

  it("allows it when every asiento is already sin efecto (none in effect)", async () => {
    getRecetaParaAccionMock.mockResolvedValue({ ...recetaPendiente, estado: "PREPARADA" as const });
    listItemIdsMock.mockResolvedValue([ITEM_1, ITEM_2]);
    asientosEnEfectoMock.mockResolvedValue([]);
    await anularRecetaCommand.execute({ id: RECETA_ID, motivo: "x" }, { session: fakeSession("recetas.anular") });
    expect(anularRecetaMock).toHaveBeenCalledTimes(1);
  });

  it("refuses while a preparación is still INICIADA (confirming it later would create the asiento)", async () => {
    getRecetaParaAccionMock.mockResolvedValue({ ...recetaPendiente, estado: "EN_PREPARACION" as const });
    listItemIdsMock.mockResolvedValue([ITEM_1, ITEM_2]);
    itemsConPreparacionIniciadaMock.mockResolvedValue([ITEM_2]);
    await expect(anularRecetaCommand.execute({ id: RECETA_ID, motivo: "x" }, { session: fakeSession("recetas.anular") })).rejects.toThrow(
      "el ítem 2 tiene una preparación en curso",
    );
    expect(anularRecetaMock).not.toHaveBeenCalled();
  });
});
