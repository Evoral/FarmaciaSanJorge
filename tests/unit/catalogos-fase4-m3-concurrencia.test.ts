/**
 * M1/M3 (review findings) unit regression tests for FASE 4 (4.1-4.3):
 * unidades, drogas, proveedores. Same shape as
 * tests/unit/usuarios-m3-lock-order.test.ts -- mocked repository/tx, no DB
 * (tests/db/catalogos-guards.test.ts covers the real SQL/trigger shape).
 *
 * Confirmed defects fixed here (see each application/*.ts file's own doc
 * comment for the full writeup):
 *   M3 (all three modules, editar/baja/reactivar): the target row used to
 *   be read UNLOCKED before any decision was made -- two concurrent
 *   actions on the same row could both read stale state and both proceed.
 *   Fix: lock first (`lockXParaAccion`), THEN read (`getXParaAccion`) with
 *   a fresh statement. Also: editar's compare-and-swap never looked at
 *   fechaBaja/motivoBaja, so a concurrent baja was invisible to an edit in
 *   flight -- fix: after the (now-locked) fresh read, editar rejects when
 *   fechaBaja is no longer null.
 *   M1 (drogas only): editarDroga's DP-12 check
 *   (`tieneAlgunaPartida`) used to run against data that could already be
 *   stale by UPDATE time -- fix: lock first (closes the [APP] half; the
 *   [DB] half is migration 0028's trigger, proven in the DB test file).
 *
 * Each block below proves, for ONE representative command per concern:
 *   1. lock is called BEFORE the fresh read (call order).
 *   2. the handler decides from the LOCKED READ's values, not from any
 *      earlier snapshot.
 *
 * All `vi.mock`/dynamic imports live at true MODULE top level (not inside
 * `describe`), same requirement as tests/unit/usuarios-m3-lock-order.test.ts
 * -- `vi.mock` is only reliably hoisted there, and a `describe` callback is
 * not an async function, so `await import(...)` cannot live inside one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ConflictError, DomainError } from "@/shared/errors";

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
const UNIDAD_ID = "33333333-3333-4333-a333-333333333333";
const UNIDAD_ID_2 = "44444444-4444-4444-a444-444444444444";

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
// drogas -- mocks + imports (top level)
// ============================================================================
const drogaCallOrder: string[] = [];
const lockDrogaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  drogaCallOrder.push("lock");
  return true;
});
const getDrogaParaAccionMock = vi.fn();
const tieneAlgunaPartidaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  drogaCallOrder.push("tienePartidas");
  return false;
});
const existeNombreVigenteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const updateDrogaDatosMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const cambiarBajaDrogaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});

vi.mock("@/modules/drogas/infrastructure/droga-repository", () => ({
  lockDrogaParaAccion: (...args: unknown[]) => lockDrogaMock(...args),
  getDrogaParaAccion: (...args: unknown[]) => getDrogaParaAccionMock(...args),
  tieneAlgunaPartida: (...args: unknown[]) => tieneAlgunaPartidaMock(...args),
  existeNombreVigente: (...args: unknown[]) => existeNombreVigenteMock(...args),
  updateDrogaDatos: (...args: unknown[]) => updateDrogaDatosMock(...args),
  cambiarBajaDroga: (...args: unknown[]) => cambiarBajaDrogaMock(...args),
}));

const { editarDrogaCommand } = await import("@/modules/drogas/application/editar-droga");
const { darDeBajaDrogaCommand } = await import("@/modules/drogas/application/dar-de-baja-droga");
const { reactivarDrogaCommand } = await import("@/modules/drogas/application/reactivar-droga");

// ============================================================================
// proveedores -- mocks + imports (top level)
// ============================================================================
const proveedorCallOrder: string[] = [];
const lockProveedorMock = vi.fn(async (...args: unknown[]) => {
  void args;
  proveedorCallOrder.push("lock");
  return true;
});
const getProveedorParaAccionMock = vi.fn();
const existeCuitMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const updateProveedorDatosMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const cambiarBajaProveedorMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});

vi.mock("@/modules/proveedores/infrastructure/proveedor-repository", () => ({
  lockProveedorParaAccion: (...args: unknown[]) => lockProveedorMock(...args),
  getProveedorParaAccion: (...args: unknown[]) => getProveedorParaAccionMock(...args),
  existeCuit: (...args: unknown[]) => existeCuitMock(...args),
  updateProveedorDatos: (...args: unknown[]) => updateProveedorDatosMock(...args),
  cambiarBajaProveedor: (...args: unknown[]) => cambiarBajaProveedorMock(...args),
}));

const { editarProveedorCommand } = await import("@/modules/proveedores/application/editar-proveedor");
const { darDeBajaProveedorCommand } = await import("@/modules/proveedores/application/dar-de-baja-proveedor");
const { reactivarProveedorCommand } = await import("@/modules/proveedores/application/reactivar-proveedor");

// ============================================================================
// unidades -- mocks + imports (top level)
// ============================================================================
const unidadCallOrder: string[] = [];
const lockUnidadMock = vi.fn(async (...args: unknown[]) => {
  void args;
  unidadCallOrder.push("lock");
  return true;
});
const getUnidadParaAccionMock = vi.fn();
const existeCodigoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const updateUnidadDatosMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const cambiarBajaUnidadMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});

vi.mock("@/modules/unidades/infrastructure/unidad-repository", () => ({
  lockUnidadParaAccion: (...args: unknown[]) => lockUnidadMock(...args),
  getUnidadParaAccion: (...args: unknown[]) => getUnidadParaAccionMock(...args),
  existeCodigo: (...args: unknown[]) => existeCodigoMock(...args),
  updateUnidadDatos: (...args: unknown[]) => updateUnidadDatosMock(...args),
  cambiarBajaUnidad: (...args: unknown[]) => cambiarBajaUnidadMock(...args),
}));

const { editarUnidadCommand } = await import("@/modules/unidades/application/editar-unidad");
const { darDeBajaUnidadCommand } = await import("@/modules/unidades/application/dar-de-baja-unidad");
const { reactivarUnidadCommand } = await import("@/modules/unidades/application/reactivar-unidad");

// ============================================================================
// drogas
// ============================================================================
describe("drogas M1/M3: lock-then-fresh-read", () => {
  const vigente = {
    id: TARGET_ID,
    nombre: "Droga X",
    unidadBaseId: UNIDAD_ID,
    densidad: null,
    esControlada: false,
    tipoControl: "NINGUNO",
    stockMinimo: "0",
    fechaBaja: null,
    motivoBaja: null,
  };

  beforeEach(() => {
    drogaCallOrder.length = 0;
    lockDrogaMock.mockClear();
    getDrogaParaAccionMock.mockReset();
    tieneAlgunaPartidaMock.mockClear();
    updateDrogaDatosMock.mockClear();
    cambiarBajaDrogaMock.mockClear();
  });

  it("editarDroga (M2): rejects a classification change when the LOCKED, fresh read shows the droga has partidas", async () => {
    getDrogaParaAccionMock.mockImplementation(async () => {
      drogaCallOrder.push("read");
      return vigente;
    });
    tieneAlgunaPartidaMock.mockImplementation(async () => {
      drogaCallOrder.push("tienePartidas");
      return true; // simulates a partida that a concurrent transaction just committed
    });

    let caught: unknown;
    try {
      await editarDrogaCommand.execute(
        {
          id: TARGET_ID,
          nombre: "Droga X",
          unidadBaseId: UNIDAD_ID_2, // classification change: unidadBaseId
          esControlada: false,
          tipoControl: "NINGUNO",
          stockMinimo: "0",
          version: { nombre: "Droga X", unidadBaseId: UNIDAD_ID, esControlada: false, tipoControl: "NINGUNO", stockMinimo: "0" },
        },
        { session: fakeSession("drogas.editar") },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect(drogaCallOrder).toEqual(["lock", "read", "tienePartidas"]);
    expect(updateDrogaDatosMock).not.toHaveBeenCalled();
  });

  it("editarDroga (M2): allows the SAME classification change when the LOCKED, fresh read shows no partidas", async () => {
    getDrogaParaAccionMock.mockImplementation(async () => {
      drogaCallOrder.push("read");
      return vigente;
    });
    tieneAlgunaPartidaMock.mockImplementation(async () => {
      drogaCallOrder.push("tienePartidas");
      return false;
    });

    await editarDrogaCommand.execute(
      {
        id: TARGET_ID,
        nombre: "Droga X",
        unidadBaseId: UNIDAD_ID_2,
        esControlada: false,
        tipoControl: "NINGUNO",
        stockMinimo: "0",
        version: { nombre: "Droga X", unidadBaseId: UNIDAD_ID, esControlada: false, tipoControl: "NINGUNO", stockMinimo: "0" },
      },
      { session: fakeSession("drogas.editar") },
    );

    expect(drogaCallOrder).toEqual(["lock", "read", "tienePartidas"]);
    expect(updateDrogaDatosMock).toHaveBeenCalledTimes(1);
  });

  it("editarDroga (M3): rejects the edit when the LOCKED, fresh read shows the droga was given de baja concurrently", async () => {
    getDrogaParaAccionMock.mockImplementation(async () => {
      drogaCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "Descontinuada" };
    });

    let caught: unknown;
    try {
      await editarDrogaCommand.execute(
        {
          id: TARGET_ID,
          nombre: "Droga X (renombrada)",
          unidadBaseId: UNIDAD_ID,
          esControlada: false,
          tipoControl: "NINGUNO",
          stockMinimo: "0",
          version: { nombre: "Droga X", unidadBaseId: UNIDAD_ID, esControlada: false, tipoControl: "NINGUNO", stockMinimo: "0" },
        },
        { session: fakeSession("drogas.editar") },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    expect(drogaCallOrder).toEqual(["lock", "read"]);
    expect(updateDrogaDatosMock).not.toHaveBeenCalled();
  });

  it("darDeBajaDroga (M3): locks BEFORE reading the current state", async () => {
    getDrogaParaAccionMock.mockImplementation(async () => {
      drogaCallOrder.push("read");
      return vigente;
    });

    await darDeBajaDrogaCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("drogas.baja") });

    expect(drogaCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaDrogaMock).toHaveBeenCalledTimes(1);
  });

  it("reactivarDroga (M3): locks BEFORE reading the current state", async () => {
    getDrogaParaAccionMock.mockImplementation(async () => {
      drogaCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "Descontinuada" };
    });

    await reactivarDrogaCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("drogas.reactivar") });

    expect(drogaCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaDrogaMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// proveedores
// ============================================================================
describe("proveedores M3: lock-then-fresh-read", () => {
  const vigente = { id: TARGET_ID, razonSocial: "Prov X", cuit: "20123456786", fechaBaja: null, motivoBaja: null };

  beforeEach(() => {
    proveedorCallOrder.length = 0;
    lockProveedorMock.mockClear();
    getProveedorParaAccionMock.mockReset();
    updateProveedorDatosMock.mockClear();
    cambiarBajaProveedorMock.mockClear();
  });

  it("editarProveedor (M3): rejects the edit when the LOCKED, fresh read shows the proveedor was given de baja concurrently", async () => {
    getProveedorParaAccionMock.mockImplementation(async () => {
      proveedorCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "Cerró" };
    });

    let caught: unknown;
    try {
      await editarProveedorCommand.execute(
        { id: TARGET_ID, razonSocial: "Prov X (renombrado)", cuit: "20123456786", version: { razonSocial: "Prov X", cuit: "20123456786" } },
        { session: fakeSession("proveedores.gestionar") },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    expect(proveedorCallOrder).toEqual(["lock", "read"]);
    expect(updateProveedorDatosMock).not.toHaveBeenCalled();
  });

  it("editarProveedor: locks BEFORE reading, and proceeds when vigente", async () => {
    getProveedorParaAccionMock.mockImplementation(async () => {
      proveedorCallOrder.push("read");
      return vigente;
    });

    await editarProveedorCommand.execute(
      { id: TARGET_ID, razonSocial: "Prov X (renombrado)", cuit: "20123456786", version: { razonSocial: "Prov X", cuit: "20123456786" } },
      { session: fakeSession("proveedores.gestionar") },
    );

    expect(proveedorCallOrder).toEqual(["lock", "read"]);
    expect(updateProveedorDatosMock).toHaveBeenCalledTimes(1);
  });

  it("darDeBajaProveedor (M3): locks BEFORE reading the current state", async () => {
    getProveedorParaAccionMock.mockImplementation(async () => {
      proveedorCallOrder.push("read");
      return vigente;
    });

    await darDeBajaProveedorCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("proveedores.gestionar") });

    expect(proveedorCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaProveedorMock).toHaveBeenCalledTimes(1);
  });

  it("reactivarProveedor (M3): locks BEFORE reading the current state", async () => {
    getProveedorParaAccionMock.mockImplementation(async () => {
      proveedorCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "Cerró" };
    });

    await reactivarProveedorCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("proveedores.gestionar") });

    expect(proveedorCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaProveedorMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// unidades
// ============================================================================
describe("unidades M3: lock-then-fresh-read", () => {
  const vigente = {
    id: TARGET_ID,
    codigo: "GRAMO",
    nombre: "Gramo",
    simbolo: "g",
    tipoMagnitud: "MASA",
    factorABase: "1",
    esBase: true,
    usada: false,
    fechaBaja: null,
    motivoBaja: null,
  };

  beforeEach(() => {
    unidadCallOrder.length = 0;
    lockUnidadMock.mockClear();
    getUnidadParaAccionMock.mockReset();
    updateUnidadDatosMock.mockClear();
    cambiarBajaUnidadMock.mockClear();
  });

  it("editarUnidad (M3): rejects the edit when the LOCKED, fresh read shows the unidad was given de baja concurrently", async () => {
    getUnidadParaAccionMock.mockImplementation(async () => {
      unidadCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "en desuso" };
    });

    let caught: unknown;
    try {
      await editarUnidadCommand.execute(
        {
          id: TARGET_ID,
          codigo: "GRAMO",
          nombre: "Gramo (renombrado)",
          simbolo: "g",
          tipoMagnitud: "MASA",
          factorABase: "1",
          version: { codigo: "GRAMO", nombre: "Gramo", simbolo: "g", tipoMagnitud: "MASA", factorABase: "1" },
        },
        { session: fakeSession("unidades.editar") },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    expect(unidadCallOrder).toEqual(["lock", "read"]);
    expect(updateUnidadDatosMock).not.toHaveBeenCalled();
  });

  it("editarUnidad: locks BEFORE reading, and proceeds when vigente", async () => {
    getUnidadParaAccionMock.mockImplementation(async () => {
      unidadCallOrder.push("read");
      return vigente;
    });

    await editarUnidadCommand.execute(
      {
        id: TARGET_ID,
        codigo: "GRAMO",
        nombre: "Gramo (renombrado)",
        simbolo: "g",
        tipoMagnitud: "MASA",
        factorABase: "1",
        version: { codigo: "GRAMO", nombre: "Gramo", simbolo: "g", tipoMagnitud: "MASA", factorABase: "1" },
      },
      { session: fakeSession("unidades.editar") },
    );

    expect(unidadCallOrder).toEqual(["lock", "read"]);
    expect(updateUnidadDatosMock).toHaveBeenCalledTimes(1);
  });

  it("darDeBajaUnidad (M3): locks BEFORE reading the current state", async () => {
    getUnidadParaAccionMock.mockImplementation(async () => {
      unidadCallOrder.push("read");
      return vigente;
    });

    await darDeBajaUnidadCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("unidades.baja") });

    expect(unidadCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaUnidadMock).toHaveBeenCalledTimes(1);
  });

  it("reactivarUnidad (M3): locks BEFORE reading the current state", async () => {
    getUnidadParaAccionMock.mockImplementation(async () => {
      unidadCallOrder.push("read");
      return { ...vigente, fechaBaja: new Date("2026-01-01"), motivoBaja: "en desuso" };
    });

    await reactivarUnidadCommand.execute({ id: TARGET_ID, motivo: "Motivo de prueba." }, { session: fakeSession("unidades.baja") });

    expect(unidadCallOrder).toEqual(["lock", "read"]);
    expect(cambiarBajaUnidadMock).toHaveBeenCalledTimes(1);
  });
});
