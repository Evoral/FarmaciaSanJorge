/**
 * M3-discipline unit tests for FASE 5's write commands: lock BEFORE any
 * fresh read that a decision depends on (same discipline as
 * tests/unit/catalogos-fase4-m3-concurrencia.test.ts and
 * modules/usuarios/infrastructure/admin-guard.ts's header comment). Mocked
 * repository/tx, no DB -- tests/db covers the real SQL/trigger shape.
 *
 * Also covers: `ingresar-partida.ts` converts the purchased quantity to the
 * droga's unidad base via `fsj.convertir` (never ad-hoc arithmetic) BEFORE
 * inserting the partida.
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
const PARTIDA_ID = "22222222-2222-4222-a222-222222222222";
const DROGA_ID = "33333333-3333-4333-a333-333333333333";
const PROVEEDOR_ID = "44444444-4444-4444-a444-444444444444";
const DT_ID = "55555555-5555-4555-a555-555555555555";
const UNIDAD_COMPRA_ID = "66666666-6666-4666-a666-666666666666";
const UNIDAD_BASE_ID = "77777777-7777-4777-a777-777777777777";

function fakeSession(permiso: string): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set([permiso]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const callOrder: string[] = [];
const lockPartidaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("lock");
  return true;
});
const getPartidaParaAccionMock = vi.fn();
const insertAjusteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "mov-1" };
});
const updateCostoPartidaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const getDrogaParaIngresoMock = vi.fn();
const getProveedorParaIngresoMock = vi.fn();
const getFechaActivacionContralorMock = vi.fn(async (...args: unknown[]): Promise<Date | null> => {
  void args;
  return null;
});
const jornadaActualTenantMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return "2026-06-15";
});
const convertirUnidadMock = vi.fn(async (...args: unknown[]) => {
  const [, valor] = args as [unknown, string];
  return valor;
});
const insertPartidaConIngresoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "partida-nueva" };
});

vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  lockPartidaParaAccion: (...args: unknown[]) => lockPartidaMock(...args),
  getPartidaParaAccion: (...args: unknown[]) => getPartidaParaAccionMock(...args),
  insertAjuste: (...args: unknown[]) => insertAjusteMock(...args),
  updateCostoPartida: (...args: unknown[]) => updateCostoPartidaMock(...args),
  getDrogaParaIngreso: (...args: unknown[]) => getDrogaParaIngresoMock(...args),
  getProveedorParaIngreso: (...args: unknown[]) => getProveedorParaIngresoMock(...args),
  getFechaActivacionContralor: (...args: unknown[]) => getFechaActivacionContralorMock(...args),
  jornadaActualTenant: (...args: unknown[]) => jornadaActualTenantMock(...args),
  convertirUnidad: (...args: unknown[]) => convertirUnidadMock(...args),
  insertPartidaConIngreso: (...args: unknown[]) => insertPartidaConIngresoMock(...args),
}));

// FIX 4 (jd-fix-agent, 2026-09-23): registrarAjusteStock's internal command
// (which trusts autorizadoPorId) is no longer exported -- see
// modules/stock/application/registrar-ajuste.ts's module doc comment.
// These tests go through the public wrapper, with the co-firma command
// mocked at the module boundary (defaults to a successful co-firma so the
// M3 lock-order assertions below are unaffected).
const verificarCoFirmaExecuteMock = vi.fn();
vi.mock("@/modules/stock/application/verificar-co-firma-dt", () => ({
  verificarCoFirmaDtCommand: {
    execute: (...args: unknown[]) => verificarCoFirmaExecuteMock(...args),
  },
}));

const { registrarAjusteStock } = await import("@/modules/stock/application/registrar-ajuste");
const { corregirCostoPartidaCommand } = await import("@/modules/stock/application/corregir-costo-partida");
const { ingresarPartidaCommand } = await import("@/modules/stock/application/ingresar-partida");

const partidaVigente = {
  id: PARTIDA_ID,
  drogaId: DROGA_ID,
  drogaNombre: "Droga X",
  proveedorId: PROVEEDOR_ID,
  proveedorRazonSocial: "Prov X",
  lote: "L1",
  costoUnitario: "10",
  cantidadInicial: "100",
  cantidadDisponible: "40",
  fechaIngreso: new Date("2026-01-01"),
  fechaVencimiento: new Date("2026-12-31"),
  fechaApertura: null,
};

describe("registrar-ajuste: lock BEFORE the fresh balance read", () => {
  beforeEach(() => {
    callOrder.length = 0;
    lockPartidaMock.mockClear();
    getPartidaParaAccionMock.mockReset();
    insertAjusteMock.mockClear();
    verificarCoFirmaExecuteMock.mockReset().mockResolvedValue({ ok: true, dtUsuarioId: DT_ID });
  });

  it("rejects when the LOCKED, fresh balance is smaller than the requested ajuste (a concurrent egreso reduced it)", async () => {
    getPartidaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return { ...partidaVigente, cantidadDisponible: "5" }; // fresh balance, lower than the 20 requested
    });

    let caught: unknown;
    try {
      await registrarAjusteStock(
        { partidaId: PARTIDA_ID, cantidad: "20", motivoAjuste: "ROTURA", observacion: "obs", dtUsuarioId: DT_ID, dtPassword: "correcta" },
        { session: fakeSession("stock.ajuste.registrar") },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect(callOrder).toEqual(["lock", "read"]);
    expect(insertAjusteMock).not.toHaveBeenCalled();
  });

  it("locks BEFORE reading, and proceeds (subtracting) when the fresh balance covers the ajuste", async () => {
    getPartidaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return partidaVigente; // cantidadDisponible: "40"
    });

    await registrarAjusteStock(
      { partidaId: PARTIDA_ID, cantidad: "20", motivoAjuste: "ROTURA", observacion: "obs", dtUsuarioId: DT_ID, dtPassword: "correcta" },
      { session: fakeSession("stock.ajuste.registrar") },
    );

    expect(callOrder).toEqual(["lock", "read"]);
    expect(insertAjusteMock).toHaveBeenCalledTimes(1);
    const insertInput = insertAjusteMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(insertInput.autorizadoPorId).toBe(DT_ID);
    expect(insertInput.registradoPorId).toBe("u-1"); // the OPERATOR, never the DT
  });

  it("FIX 4: a REJECTED co-firma throws before the partida is ever locked (no bypass path)", async () => {
    verificarCoFirmaExecuteMock.mockResolvedValue({ ok: false, message: "No se pudo validar la contraseña del Director Técnico." });

    let caught: unknown;
    try {
      await registrarAjusteStock(
        { partidaId: PARTIDA_ID, cantidad: "20", motivoAjuste: "ROTURA", observacion: "obs", dtUsuarioId: DT_ID, dtPassword: "incorrecta" },
        { session: fakeSession("stock.ajuste.registrar") },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect(lockPartidaMock).not.toHaveBeenCalled();
    expect(insertAjusteMock).not.toHaveBeenCalled();
  });

  it("404s when the locked target does not exist (no row to lock)", async () => {
    lockPartidaMock.mockImplementationOnce(async () => {
      callOrder.push("lock");
      return false;
    });

    let caught: unknown;
    try {
      await registrarAjusteStock(
        { partidaId: PARTIDA_ID, cantidad: "1", motivoAjuste: "ROTURA", observacion: "obs", dtUsuarioId: DT_ID, dtPassword: "correcta" },
        { session: fakeSession("stock.ajuste.registrar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(getPartidaParaAccionMock).not.toHaveBeenCalled();
  });
});

describe("corregir-costo-partida: lock BEFORE the fresh optimistic-version read", () => {
  beforeEach(() => {
    callOrder.length = 0;
    lockPartidaMock.mockClear();
    getPartidaParaAccionMock.mockReset();
    updateCostoPartidaMock.mockClear().mockResolvedValue(true);
  });

  it("locks BEFORE reading, then updates using the FRESH costoUnitario as the optimistic version", async () => {
    getPartidaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return { ...partidaVigente, costoUnitario: "12.50" }; // fresh value, changed since the form loaded
    });

    await corregirCostoPartidaCommand.execute(
      { id: PARTIDA_ID, costoUnitarioNuevo: "15", motivo: "Corrección de precio de lista." },
      { session: fakeSession("stock.partida.costo.corregir") },
    );

    expect(callOrder).toEqual(["lock", "read"]);
    expect(updateCostoPartidaMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ costoUnitarioAnterior: "12.50", costoUnitarioNuevo: "15" }),
    );
  });

  it("surfaces a ConflictError when the optimistic update matches zero rows (raced by another correction)", async () => {
    getPartidaParaAccionMock.mockImplementation(async () => {
      callOrder.push("read");
      return partidaVigente;
    });
    updateCostoPartidaMock.mockResolvedValueOnce(false);

    let caught: unknown;
    try {
      await corregirCostoPartidaCommand.execute(
        { id: PARTIDA_ID, costoUnitarioNuevo: "15", motivo: "Corrección de precio de lista." },
        { session: fakeSession("stock.partida.costo.corregir") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConflictError);
  });
});

describe("ingresar-partida: converts the purchased quantity to the droga's unidad base before inserting", () => {
  beforeEach(() => {
    getDrogaParaIngresoMock.mockReset().mockResolvedValue({ id: DROGA_ID, unidadBaseId: UNIDAD_BASE_ID, tipoControl: "NINGUNO", fechaBaja: null });
    getProveedorParaIngresoMock.mockReset().mockResolvedValue({ id: PROVEEDOR_ID, fechaBaja: null });
    getFechaActivacionContralorMock.mockReset().mockResolvedValue(null);
    jornadaActualTenantMock.mockReset().mockResolvedValue("2026-06-15");
    convertirUnidadMock.mockReset().mockResolvedValue("5000"); // e.g. 5 caja -> 5000 unidad base
    insertPartidaConIngresoMock.mockReset().mockResolvedValue({ id: "partida-nueva" });
  });

  it("calls fsj.convertir with the FORM unit as origin and the droga's unidadBaseId as destination, and inserts the CONVERTED quantity", async () => {
    await ingresarPartidaCommand.execute(
      {
        drogaId: DROGA_ID,
        proveedorId: PROVEEDOR_ID,
        lote: "L1",
        fechaVencimiento: "2027-01-01",
        cantidadCompra: "5",
        unidadCompraId: UNIDAD_COMPRA_ID,
        costoUnitario: "10",
      },
      { session: fakeSession("stock.partida.ingresar") },
    );

    expect(convertirUnidadMock).toHaveBeenCalledWith(expect.anything(), "5", UNIDAD_COMPRA_ID, UNIDAD_BASE_ID);
    expect(insertPartidaConIngresoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cantidadInicialBase: "5000" }),
    );
  });

  it("rejects a fechaVencimiento that is not strictly in the future (relative to the tenant's jornada)", async () => {
    jornadaActualTenantMock.mockResolvedValue("2026-06-15");
    let caught: unknown;
    try {
      await ingresarPartidaCommand.execute(
        {
          drogaId: DROGA_ID,
          proveedorId: PROVEEDOR_ID,
          lote: "L1",
          fechaVencimiento: "2026-06-15",
          cantidadCompra: "5",
          unidadCompraId: UNIDAD_COMPRA_ID,
          costoUnitario: "10",
        },
        { session: fakeSession("stock.partida.ingresar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(insertPartidaConIngresoMock).not.toHaveBeenCalled();
  });

  it("requires numeroValeAdquisicion for a controlled droga once the contralor is active (INV-L16 app-level pre-check)", async () => {
    getDrogaParaIngresoMock.mockResolvedValue({ id: DROGA_ID, unidadBaseId: UNIDAD_BASE_ID, tipoControl: "PSICOTROPICO", fechaBaja: null });
    getFechaActivacionContralorMock.mockResolvedValue(new Date("2026-01-01"));

    let caught: unknown;
    try {
      await ingresarPartidaCommand.execute(
        {
          drogaId: DROGA_ID,
          proveedorId: PROVEEDOR_ID,
          lote: "L1",
          fechaVencimiento: "2027-01-01",
          cantidadCompra: "5",
          unidadCompraId: UNIDAD_COMPRA_ID,
          costoUnitario: "10",
        },
        { session: fakeSession("stock.partida.ingresar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(insertPartidaConIngresoMock).not.toHaveBeenCalled();
  });

  it("does NOT require numeroValeAdquisicion when the contralor is not active, even for a controlled droga", async () => {
    getDrogaParaIngresoMock.mockResolvedValue({ id: DROGA_ID, unidadBaseId: UNIDAD_BASE_ID, tipoControl: "PSICOTROPICO", fechaBaja: null });
    getFechaActivacionContralorMock.mockResolvedValue(null);

    await ingresarPartidaCommand.execute(
      {
        drogaId: DROGA_ID,
        proveedorId: PROVEEDOR_ID,
        lote: "L1",
        fechaVencimiento: "2027-01-01",
        cantidadCompra: "5",
        unidadCompraId: UNIDAD_COMPRA_ID,
        costoUnitario: "10",
      },
      { session: fakeSession("stock.partida.ingresar") },
    );

    expect(insertPartidaConIngresoMock).toHaveBeenCalledTimes(1);
  });
});
