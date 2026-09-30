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
import { Decimal } from "@/shared/decimal";

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

// Unit catalog for the ajuste unit tests (UNIDAD_BASE_ID = gramo, the droga's unidad base).
const MG_ID = "88888888-8888-4888-a888-000000000001";
const MCG_ID = "88888888-8888-4888-a888-000000000002";
const KG_ID = "88888888-8888-4888-a888-000000000003";
const LITRO_ID = "88888888-8888-4888-a888-000000000004";
const UNIDAD_U_ID = "88888888-8888-4888-a888-000000000005";
const MG_BAJA_ID = "88888888-8888-4888-a888-000000000006";
const UNIDADES_TEST = new Map(
  [
    { id: UNIDAD_BASE_ID, codigo: "GRAMO", simbolo: "g", tipoMagnitud: "MASA", factor: "1", fechaBaja: null as Date | null },
    { id: MG_ID, codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factor: "0.001", fechaBaja: null },
    { id: MCG_ID, codigo: "MICROGRAMO", simbolo: "mcg", tipoMagnitud: "MASA", factor: "0.000001", fechaBaja: null },
    { id: KG_ID, codigo: "KILOGRAMO", simbolo: "kg", tipoMagnitud: "MASA", factor: "1000", fechaBaja: null },
    { id: LITRO_ID, codigo: "LITRO", simbolo: "L", tipoMagnitud: "VOLUMEN", factor: "1000", fechaBaja: null },
    { id: UNIDAD_U_ID, codigo: "UNIDAD", simbolo: "u", tipoMagnitud: "UNIDADES", factor: "1", fechaBaja: null },
    { id: UNIDAD_COMPRA_ID, codigo: "KILOGRAMO", simbolo: "kg", tipoMagnitud: "MASA", factor: "1000", fechaBaja: null },
    { id: MG_BAJA_ID, codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factor: "0.001", fechaBaja: new Date("2026-01-01") },
  ].map((u) => [u.id, u]),
);

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
const getUnidadesParaConversionMock = vi.fn(async (...args: unknown[]) => {
  const [, ids] = args as [unknown, string[]];
  return new Map(ids.filter((id) => UNIDADES_TEST.has(id)).map((id) => [id, UNIDADES_TEST.get(id)!]));
});
/** `fsj.convertir` semantics over UNIDADES_TEST (raises across magnitudes, like INV-M01). */
async function convertirConFactores(...args: unknown[]): Promise<string> {
  const [, valor, origen, destino] = args as [unknown, string, string, string];
  const o = UNIDADES_TEST.get(origen)!;
  const d = UNIDADES_TEST.get(destino)!;
  if (o.tipoMagnitud !== d.tipoMagnitud) throw new Error("INV-M01: different tipo_magnitud");
  return new Decimal(valor).times(o.factor).div(d.factor).toFixed(10);
}

vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  lockPartidaParaAccion: (...args: unknown[]) => lockPartidaMock(...args),
  getPartidaParaAccion: (...args: unknown[]) => getPartidaParaAccionMock(...args),
  insertAjuste: (...args: unknown[]) => insertAjusteMock(...args),
  updateCostoPartida: (...args: unknown[]) => updateCostoPartidaMock(...args),
  getDrogaParaIngreso: (...args: unknown[]) => getDrogaParaIngresoMock(...args),
  getProveedorParaIngreso: (...args: unknown[]) => getProveedorParaIngresoMock(...args),
  getFechaActivacionContralor: (...args: unknown[]) => getFechaActivacionContralorMock(...args),
  getEtiquetaUnidad: async () => "gramo (g)",
  jornadaActualTenant: (...args: unknown[]) => jornadaActualTenantMock(...args),
  convertirUnidad: (...args: unknown[]) => convertirUnidadMock(...args),
  getUnidadesParaConversion: (...args: unknown[]) => getUnidadesParaConversionMock(...args),
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
  unidadBaseId: UNIDAD_BASE_ID,
  unidadBaseSimbolo: "g",
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

describe("registrar-ajuste: the quantity is entered in a chosen unit and converted to the unidad base", () => {
  const base = { partidaId: PARTIDA_ID, motivoAjuste: "ROTURA" as const, observacion: "obs", dtUsuarioId: DT_ID, dtPassword: "correcta" };
  const session = () => ({ session: fakeSession("stock.ajuste.registrar") });

  async function rechazo(promesa: Promise<unknown>): Promise<unknown> {
    try {
      await promesa;
    } catch (error) {
      return error;
    }
    throw new Error("expected a rejection");
  }

  beforeEach(() => {
    lockPartidaMock.mockClear();
    getPartidaParaAccionMock.mockReset().mockResolvedValue({ ...partidaVigente, cantidadDisponible: "500" }); // 500 g
    insertAjusteMock.mockClear();
    convertirUnidadMock.mockReset().mockImplementation(convertirConFactores);
    verificarCoFirmaExecuteMock.mockReset().mockResolvedValue({ ok: true, dtUsuarioId: DT_ID });
  });

  it("converts a practical unit (mg) to the unidad base (g) before the saldo check and the insert", async () => {
    await registrarAjusteStock({ ...base, cantidad: "250000", unidadId: MG_ID }, session());

    expect(convertirUnidadMock).toHaveBeenCalledWith(expect.anything(), "250000", MG_ID, UNIDAD_BASE_ID);
    expect(insertAjusteMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cantidad: "250" }));
  });

  it("defaults to the unidad base when no unit is sent (existing callers keep working)", async () => {
    await registrarAjusteStock({ ...base, cantidad: "20" }, session());

    expect(insertAjusteMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cantidad: "20" }));
  });

  it.each([
    ["another magnitude (L for a gram-based droga)", LITRO_ID, "no corresponde a esta droga, que se mide en g"],
    ["a non-practical unit (mcg)", MCG_ID, "no está habilitada"],
    ["a unit dada de baja", MG_BAJA_ID, "dada de baja"],
    ["a unit that does not exist", "99999999-9999-4999-a999-999999999999", "no existe"],
  ])("rejects %s on unidadId, before converting or inserting", async (_caso, unidadId, mensaje) => {
    const error = await rechazo(registrarAjusteStock({ ...base, cantidad: "1", unidadId }, session()));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain(mensaje);
    expect((error as ValidationError).fields).toEqual(["unidadId"]);
    expect(convertirUnidadMock).not.toHaveBeenCalled();
    expect(insertAjusteMock).not.toHaveBeenCalled();
  });

  it("only accepts the unidad base itself when it is not convertible (UNIDAD)", async () => {
    getPartidaParaAccionMock.mockResolvedValue({ ...partidaVigente, unidadBaseId: UNIDAD_U_ID, unidadBaseSimbolo: "u", cantidadDisponible: "10" });

    const error = await rechazo(registrarAjusteStock({ ...base, cantidad: "1", unidadId: UNIDAD_BASE_ID }, session()));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["unidadId"]);

    await registrarAjusteStock({ ...base, cantidad: "3", unidadId: UNIDAD_U_ID }, session());
    expect(insertAjusteMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cantidad: "3" }));
  });

  it.each([
    ["g", UNIDAD_BASE_ID, "600", "La cantidad a descontar (600 g) supera el saldo disponible de la partida (500 g)."],
    ["kg", KG_ID, "0.6", "La cantidad a descontar (0,6 kg) supera el saldo disponible de la partida (0,5 kg)."],
    ["mg", MG_ID, "500001", "La cantidad a descontar (500.001 mg) supera el saldo disponible de la partida (500.000 mg)."],
  ])("reports an exceeded saldo in the ENTERED unit (%s), on the cantidad field", async (_simbolo, unidadId, cantidad, mensaje) => {
    const error = await rechazo(registrarAjusteStock({ ...base, cantidad, unidadId }, session()));

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe(mensaje);
    expect((error as DomainError).fields).toEqual(["cantidad"]);
    expect(insertAjusteMock).not.toHaveBeenCalled();
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

  it("rejects a purchase unit of another magnitude on unidadCompraId BEFORE calling fsj.convertir", async () => {
    let caught: unknown;
    try {
      await ingresarPartidaCommand.execute(
        {
          drogaId: DROGA_ID,
          proveedorId: PROVEEDOR_ID,
          lote: "L1",
          fechaVencimiento: "2027-01-01",
          cantidadCompra: "5",
          unidadCompraId: LITRO_ID,
          costoUnitario: "10",
        },
        { session: fakeSession("stock.partida.ingresar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).fields).toEqual(["unidadCompraId"]);
    expect((caught as ValidationError).message).toContain("no corresponde a esta droga, que se mide en g");
    expect(convertirUnidadMock).not.toHaveBeenCalled();
    expect(insertPartidaConIngresoMock).not.toHaveBeenCalled();
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
