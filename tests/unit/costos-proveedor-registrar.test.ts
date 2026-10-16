/**
 * Unit tests for `registrarCostosProveedor` and `darDeBajaCostoProveedor` (docs/specs/costos-proveedor.md
 * R2, R9-R12, R20, R23, R24; CP1-CP6, CP10). The repository is mocked, the domain is the real one: what is
 * under test is the command's ORDER (lock before deciding, plan before writing, close + insert with the same
 * instant) and what it refuses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";

const {
  TENANT_ID,
  USUARIO_ID,
  PROVEEDOR_ID,
  DROGA_ID,
  DROGA_2_ID,
  UNIDAD_KG_ID,
  UNIDAD_G_ID,
  UNIDAD_L_ID,
  COSTO_ID,
  NUEVO_ID,
  AHORA,
  callOrder,
  state,
  auditRecordMock,
  withTenantTransactionMock,
  jornadaActualTenantMock,
  getProveedorParaCostoMock,
  getDrogasParaCostoMock,
  getUnidadesParaCostoMock,
  lockVigentesMock,
  lockCostoPorIdMock,
  cerrarVigenteMock,
  insertCostoProveedorMock,
  ahoraServidorMock,
} = vi.hoisted(() => {
  const TENANT_ID = "11111111-1111-1111-1111-111111111111";
  const USUARIO_ID = "22222222-2222-4222-a222-222222222222";
  const PROVEEDOR_ID = "33333333-3333-4333-a333-333333333333";
  const DROGA_ID = "44444444-4444-4444-a444-444444444444";
  const DROGA_2_ID = "55555555-5555-4555-a555-555555555555";
  const UNIDAD_KG_ID = "66666666-6666-4666-a666-666666666666";
  const UNIDAD_G_ID = "77777777-7777-4777-a777-777777777777";
  const UNIDAD_MG_ID = "88888888-8888-4888-a888-888888888888";
  const UNIDAD_L_ID = "99999999-9999-4999-a999-999999999999";
  const COSTO_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const NUEVO_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const AHORA = new Date("2026-10-15T12:00:00.000Z");
  const callOrder: string[] = [];

  const unidades = new Map([
    [UNIDAD_KG_ID, { id: UNIDAD_KG_ID, codigo: "KILOGRAMO", simbolo: "kg", tipoMagnitud: "MASA", factorABase: "1000", fechaBaja: null as Date | null }],
    [UNIDAD_G_ID, { id: UNIDAD_G_ID, codigo: "GRAMO", simbolo: "g", tipoMagnitud: "MASA", factorABase: "1", fechaBaja: null as Date | null }],
    [UNIDAD_MG_ID, { id: UNIDAD_MG_ID, codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factorABase: "0.001", fechaBaja: null as Date | null }],
    [UNIDAD_L_ID, { id: UNIDAD_L_ID, codigo: "LITRO", simbolo: "L", tipoMagnitud: "VOLUMEN", factorABase: "1000", fechaBaja: null as Date | null }],
  ]);
  const drogas = new Map([
    [DROGA_ID, { id: DROGA_ID, nombre: "Paracetamol", fechaBaja: null as Date | null, unidadBaseId: UNIDAD_MG_ID }],
    [DROGA_2_ID, { id: DROGA_2_ID, nombre: "Ibuprofeno", fechaBaja: null as Date | null, unidadBaseId: UNIDAD_MG_ID }],
  ]);

  /** What each test arranges; reset in `beforeEach`. */
  const state = {
    unidades,
    drogas,
    proveedor: { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: null as Date | null } as { id: string; razonSocial: string; fechaBaja: Date | null } | null,
    vigentes: [] as unknown[],
    costoBloqueado: null as unknown,
  };

  return {
    TENANT_ID,
    USUARIO_ID,
    PROVEEDOR_ID,
    DROGA_ID,
    DROGA_2_ID,
    UNIDAD_KG_ID,
    UNIDAD_G_ID,
    UNIDAD_MG_ID,
    UNIDAD_L_ID,
    COSTO_ID,
    NUEVO_ID,
    AHORA,
    callOrder,
    state,
    auditRecordMock: vi.fn(async (...args: unknown[]) => void args),
    withTenantTransactionMock: vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId })),
    jornadaActualTenantMock: vi.fn(async () => "2026-10-15"),
    getProveedorParaCostoMock: vi.fn(async () => state.proveedor),
    getDrogasParaCostoMock: vi.fn(async (_tx: unknown, _tenantId: string, ids: readonly string[]) => new Map([...state.drogas].filter(([id]) => ids.includes(id)))),
    getUnidadesParaCostoMock: vi.fn(async (_tx: unknown, ids: readonly string[]) => new Map([...state.unidades].filter(([id]) => ids.includes(id)))),
    lockVigentesMock: vi.fn(async () => {
      callOrder.push("lock");
      return state.vigentes;
    }),
    lockCostoPorIdMock: vi.fn(async () => {
      callOrder.push("lock");
      return state.costoBloqueado;
    }),
    cerrarVigenteMock: vi.fn(async (...args: unknown[]) => {
      void args;
      callOrder.push("cerrar");
    }),
    insertCostoProveedorMock: vi.fn(async (...args: unknown[]) => {
      void args;
      callOrder.push("insert");
      return { id: NUEVO_ID };
    }),
    ahoraServidorMock: vi.fn(async () => AHORA),
  };
});

vi.mock("@/shared/audit", () => ({
  record: auditRecordMock,
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

vi.mock("@/modules/costos-proveedor/infrastructure/costo-proveedor-repository", () => ({
  jornadaActualTenant: jornadaActualTenantMock,
  getProveedorParaCosto: getProveedorParaCostoMock,
  getDrogasParaCosto: getDrogasParaCostoMock,
  getUnidadesParaCosto: getUnidadesParaCostoMock,
  lockVigentes: lockVigentesMock,
  lockCostoPorId: lockCostoPorIdMock,
  cerrarVigente: cerrarVigenteMock,
  insertCostoProveedor: insertCostoProveedorMock,
  ahoraServidor: ahoraServidorMock,
}));

const { registrarCostosProveedorCommand } = await import("@/modules/costos-proveedor/application/registrar-costos-proveedor");
const { darDeBajaCostoProveedorCommand } = await import("@/modules/costos-proveedor/application/dar-de-baja-costo-proveedor");

const session: AuthenticatedSession = {
  usuario: { id: USUARIO_ID, email: "admin@example.com", nombre: "A", apellido: "B" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["costos.proveedor.gestionar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

/** A row as the form posts it: 40.898 $/kg of Paracetamol (unidad base mg), dated 2026-10-10. */
function fila(cambios: Record<string, unknown> = {}) {
  return { drogaId: DROGA_ID, precioInformado: "40898", unidadPrecioId: UNIDAD_KG_ID, fechaPrecio: "2026-10-10", motivo: "", vigenteEsperadoId: null, ...cambios };
}

function registrar(filas: unknown[], proveedorId = PROVEEDOR_ID) {
  return registrarCostosProveedorCommand.execute({ proveedorId, filas }, { session });
}

/** A vigente costo of Paracetamol: 30.000 $/kg dated 2026-09-01. */
function vigente(cambios: Record<string, unknown> = {}) {
  return {
    id: COSTO_ID,
    drogaId: DROGA_ID,
    proveedorId: PROVEEDOR_ID,
    precioInformado: "30000",
    unidadPrecioId: UNIDAD_KG_ID,
    costoUnitario: "0.03",
    fechaPrecio: "2026-09-01",
    vigenteDesde: new Date("2026-09-02T10:00:00.000Z"),
    ...cambios,
  };
}

function sinEscrituras() {
  expect(insertCostoProveedorMock).not.toHaveBeenCalled();
  expect(cerrarVigenteMock).not.toHaveBeenCalled();
  expect(auditRecordMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  state.vigentes = [];
  state.costoBloqueado = null;
  state.proveedor = { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: null };
  state.drogas.get(DROGA_ID)!.fechaBaja = null;
  state.drogas.get(DROGA_2_ID)!.fechaBaja = null;
  for (const unidad of state.unidades.values()) unidad.fechaBaja = null;
});

describe("registrarCostosProveedor -- versioning (R2, R9, R10)", () => {
  it("INSERTAR: the first price of a pair is inserted with the converted cost, the server instant and no lista (CP1)", async () => {
    const resultado = await registrar([fila()]);

    expect(resultado).toMatchObject({ insertados: 1, reemplazados: 0, sinCambios: 0, ids: [NUEVO_ID] });
    expect(cerrarVigenteMock).not.toHaveBeenCalled();
    expect(insertCostoProveedorMock).toHaveBeenCalledTimes(1);
    expect(insertCostoProveedorMock.mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT_ID,
      drogaId: DROGA_ID,
      proveedorId: PROVEEDOR_ID,
      precioInformado: "40898",
      unidadPrecioId: UNIDAD_KG_ID,
      // 40.898 $/kg per mg: 1 kg = 1.000.000 mg.
      costoUnitario: "0.040898",
      fechaPrecio: "2026-10-10",
      listaPrecioId: null,
      motivo: null,
      vigenteDesde: AHORA,
      creadoPorId: USUARIO_ID,
    });
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    const auditoria = auditRecordMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(auditoria).toMatchObject({ tenantId: TENANT_ID, usuarioId: USUARIO_ID, entidad: "costo_proveedor", entidadId: NUEVO_ID, accion: "CREAR" });
    expect(auditoria.valorAnterior).toBeUndefined();
    expect(auditoria.valorNuevo).toMatchObject({ droga: "Paracetamol", proveedor: "Droguería Sur", precioInformado: "40898", unidadPrecio: "kg", costoUnitario: "0.040898" });
  });

  it("the cost follows the unidad de precio chosen: $ 40.898 per g is $ 40,898 per mg (CP1)", async () => {
    await registrar([fila({ unidadPrecioId: UNIDAD_G_ID })]);
    expect(insertCostoProveedorMock.mock.calls[0]![1]).toMatchObject({ costoUnitario: "40.898" });
  });

  it("REEMPLAZAR: closes the vigente and inserts the new version with the SAME instant; the audit keeps the closed version as valorAnterior (CP4)", async () => {
    state.vigentes = [vigente()];

    const resultado = await registrar([fila({ vigenteEsperadoId: COSTO_ID })]);

    expect(resultado).toMatchObject({ insertados: 0, reemplazados: 1, sinCambios: 0, ids: [NUEVO_ID] });
    expect(cerrarVigenteMock).toHaveBeenCalledTimes(1);
    expect(cerrarVigenteMock.mock.calls[0]!.slice(1)).toEqual([TENANT_ID, COSTO_ID, AHORA]);
    expect(insertCostoProveedorMock.mock.calls[0]![1]).toMatchObject({ vigenteDesde: AHORA });
    // The closed version's vigente_hasta and the new one's vigente_desde are the very same Date.
    expect(cerrarVigenteMock.mock.calls[0]![3]).toBe((insertCostoProveedorMock.mock.calls[0]![1] as { vigenteDesde: Date }).vigenteDesde);
    expect(callOrder).toEqual(["lock", "cerrar", "insert"]);
    expect(ahoraServidorMock).toHaveBeenCalledTimes(1);

    const auditoria = auditRecordMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(auditoria).toMatchObject({ entidad: "costo_proveedor", accion: "CREAR", entidadId: NUEVO_ID });
    expect(auditoria.valorAnterior).toEqual({ precioInformado: "30000", unidadPrecio: "kg", costoUnitario: "0.03", fechaPrecio: "2026-09-01" });
    expect(auditoria.valorNuevo).toMatchObject({ precioInformado: "40898", unidadPrecio: "kg", costoUnitario: "0.040898", fechaPrecio: "2026-10-10" });
  });

  it("SIN_CAMBIOS: same price, unit and date writes nothing and says so (CP6)", async () => {
    state.vigentes = [vigente({ precioInformado: "40898", fechaPrecio: "2026-10-10" })];

    const resultado = await registrar([fila({ vigenteEsperadoId: COSTO_ID })]);

    expect(resultado).toMatchObject({ insertados: 0, reemplazados: 0, sinCambios: 1, ids: [] });
    expect(resultado.filas).toEqual([{ indice: 0, resultado: "SIN_CAMBIOS", id: null }]);
    sinEscrituras();
    expect(ahoraServidorMock).not.toHaveBeenCalled();
  });

  it("the same price with a LATER date is a new version, not sin cambios (CP6)", async () => {
    state.vigentes = [vigente({ precioInformado: "40898", fechaPrecio: "2026-10-01" })];

    const resultado = await registrar([fila({ vigenteEsperadoId: COSTO_ID })]);

    expect(resultado).toMatchObject({ reemplazados: 1, sinCambios: 0 });
    expect(cerrarVigenteMock).toHaveBeenCalledTimes(1);
  });

  it("MAS_ANTIGUA: an older fecha_precio than the vigente is refused, pointing at the date, writing nothing (CP5)", async () => {
    state.vigentes = [vigente({ fechaPrecio: "2026-10-12" })];

    const error = await registrar([fila({ fechaPrecio: "2026-10-10", vigenteEsperadoId: COSTO_ID })]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["filas.0.fechaPrecio"]);
    expect((error as ValidationError).message).toMatch(/12\/10\/2026/);
    sinEscrituras();
    expect(ahoraServidorMock).not.toHaveBeenCalled();
  });
});

describe("registrarCostosProveedor -- validation (R3, R5, R8, R12)", () => {
  it("rejects a droga repeated in the batch, flagging every row of the group, before locking anything", async () => {
    const error = await registrar([fila(), fila({ precioInformado: "41000" }), fila({ drogaId: DROGA_2_ID })]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["filas.0.drogaId", "filas.1.drogaId"]);
    expect(lockVigentesMock).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("rejects a droga de baja (R12)", async () => {
    state.drogas.get(DROGA_ID)!.fechaBaja = new Date("2026-01-01T00:00:00Z");

    const error = await registrar([fila()]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["filas.0.drogaId"]);
    expect((error as ValidationError).message).toMatch(/Paracetamol.*baja/);
    expect(lockVigentesMock).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("rejects a proveedor de baja (R12)", async () => {
    state.proveedor = { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: new Date("2026-01-01T00:00:00Z") };

    const error = await registrar([fila()]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).fields).toEqual(["proveedorId"]);
    expect(lockVigentesMock).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("rejects an unknown proveedor and an unknown droga", async () => {
    state.proveedor = null;
    await expect(registrar([fila()])).rejects.toBeInstanceOf(NotFoundError);

    state.proveedor = { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: null };
    const error = await registrar([fila({ drogaId: "cccccccc-cccc-4ccc-accc-cccccccccccc" })]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["filas.0.drogaId"]);
    sinEscrituras();
  });

  it("rejects a unidad de precio of another magnitud than the droga's unidad base (R5, CP2)", async () => {
    const error = await registrar([fila({ unidadPrecioId: UNIDAD_L_ID })]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["filas.0.unidadPrecioId"]);
    expect((error as ValidationError).message).toMatch(/misma magnitud/);
    expect(lockVigentesMock).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("rejects a unidad de precio that is dada de baja or does not exist", async () => {
    state.unidades.get(UNIDAD_KG_ID)!.fechaBaja = new Date("2026-01-01T00:00:00Z");
    const deBaja = await registrar([fila()]).catch((e: unknown) => e);
    expect((deBaja as ValidationError).fields).toEqual(["filas.0.unidadPrecioId"]);
    state.unidades.get(UNIDAD_KG_ID)!.fechaBaja = null;

    const inexistente = await registrar([fila({ unidadPrecioId: "dddddddd-dddd-4ddd-addd-dddddddddddd" })]).catch((e: unknown) => e);
    expect((inexistente as ValidationError).fields).toEqual(["filas.0.unidadPrecioId"]);
    sinEscrituras();
  });

  it.each([["0"], ["-5"], [""], ["abc"], ["1e3"]])("rejects the price %j pointing at the price field (CP3)", async (precio) => {
    const error = await registrar([fila({ precioInformado: precio })]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["filas.0.precioInformado"]);
    expect(withTenantTransactionMock).toHaveBeenCalled();
    sinEscrituras();
  });

  it("rejects a price so low that the converted cost rounds to zero", async () => {
    const error = await registrar([fila({ precioInformado: "0.000001" })]).catch((e: unknown) => e);

    expect((error as ValidationError).fields).toEqual(["filas.0.precioInformado"]);
    expect((error as ValidationError).message).toMatch(/demasiado bajo/);
    sinEscrituras();
  });

  it("rejects a fecha_precio after the jornada actual and one that is not a real date (R8)", async () => {
    const futura = await registrar([fila({ fechaPrecio: "2026-10-16" })]).catch((e: unknown) => e);
    expect((futura as ValidationError).fields).toEqual(["filas.0.fechaPrecio"]);
    expect((futura as ValidationError).message).toMatch(/posterior a hoy/);

    const inexistente = await registrar([fila({ fechaPrecio: "2026-02-31" })]).catch((e: unknown) => e);
    expect((inexistente as ValidationError).fields).toEqual(["filas.0.fechaPrecio"]);
    sinEscrituras();
  });

  it("rejects the whole batch when ONE row is invalid: nothing is written, every bad row is marked (R20)", async () => {
    const error = await registrar([fila(), fila({ drogaId: DROGA_2_ID, precioInformado: "0" })]).catch((e: unknown) => e);

    expect((error as ValidationError).fields).toEqual(["filas.1.precioInformado"]);
    expect((error as ValidationError).message).toMatch(/Fila 2/);
    sinEscrituras();
    expect(lockVigentesMock).not.toHaveBeenCalled();
  });

  it("requires at least one row", async () => {
    await expect(registrar([])).rejects.toBeInstanceOf(ValidationError);
    expect(jornadaActualTenantMock).not.toHaveBeenCalled();
  });
});

describe("registrarCostosProveedor -- concurrency (R23)", () => {
  it("locks the vigentes BEFORE deciding and writing, for every pair of the batch", async () => {
    await registrar([fila(), fila({ drogaId: DROGA_2_ID })]);

    expect(lockVigentesMock).toHaveBeenCalledTimes(1);
    expect(lockVigentesMock.mock.calls[0]!.slice(1)).toEqual([
      TENANT_ID,
      [
        { drogaId: DROGA_ID, proveedorId: PROVEEDOR_ID },
        { drogaId: DROGA_2_ID, proveedorId: PROVEEDOR_ID },
      ],
    ]);
    expect(callOrder).toEqual(["lock", "insert", "insert"]);
  });

  it("refuses the save when the vigente is not the one the user saw (CP10)", async () => {
    state.vigentes = [vigente({ id: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee" })];

    const error = await registrar([fila({ vigenteEsperadoId: COSTO_ID })]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("El costo de Paracetamol cambió mientras lo editabas. Volvé a cargar la página.");
    expect(callOrder).toEqual(["lock"]);
    sinEscrituras();
  });

  it("refuses the save when the user saw NO vigente but one appeared meanwhile", async () => {
    state.vigentes = [vigente()];

    await expect(registrar([fila({ vigenteEsperadoId: null })])).rejects.toThrow(/cambió mientras lo editabas/);
    sinEscrituras();
  });

  it("refuses the save when the user saw a vigente that was given de baja meanwhile", async () => {
    state.vigentes = [];

    await expect(registrar([fila({ vigenteEsperadoId: COSTO_ID })])).rejects.toThrow(/cambió mientras lo editabas/);
    sinEscrituras();
  });

  it("does not check the vigente when the row carries no expectation (the caller opted out)", async () => {
    state.vigentes = [vigente()];
    const { vigenteEsperadoId: _omitido, ...sinEsperado } = fila();
    void _omitido;

    const resultado = await registrar([sinEsperado]);

    expect(resultado.reemplazados).toBe(1);
  });
});

describe("darDeBajaCostoProveedor (R11)", () => {
  function costoBloqueado(cambios: Record<string, unknown> = {}) {
    return { ...vigente(), vigenteHasta: null as Date | null, ...cambios };
  }

  const baja = (input: unknown) => darDeBajaCostoProveedorCommand.execute(input, { session });

  it("closes the vigente costo with the server instant and audits the baja with its motivo", async () => {
    state.costoBloqueado = costoBloqueado();

    const resultado = await baja({ costoProveedorId: COSTO_ID, motivo: "  El proveedor dejó de venderla  " });

    expect(resultado).toEqual({ id: COSTO_ID });
    expect(lockCostoPorIdMock.mock.calls[0]!.slice(1)).toEqual([TENANT_ID, COSTO_ID]);
    expect(cerrarVigenteMock.mock.calls[0]!.slice(1)).toEqual([TENANT_ID, COSTO_ID, AHORA]);
    expect(insertCostoProveedorMock).not.toHaveBeenCalled();
    expect(callOrder).toEqual(["lock", "cerrar"]);
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    const auditoria = auditRecordMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(auditoria).toMatchObject({ entidad: "costo_proveedor", entidadId: COSTO_ID, accion: "BAJA", motivo: "El proveedor dejó de venderla" });
    expect(auditoria.valorAnterior).toMatchObject({ droga: "Paracetamol", proveedor: "Droguería Sur", precioInformado: "30000", unidadPrecio: "kg" });
    expect(auditoria.valorNuevo).toEqual({ vigenteHasta: AHORA.toISOString() });
  });

  it("requires a motivo: blank or missing is refused before touching the database", async () => {
    await expect(baja({ costoProveedorId: COSTO_ID, motivo: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(baja({ costoProveedorId: COSTO_ID })).rejects.toBeInstanceOf(ValidationError);

    expect(lockCostoPorIdMock).not.toHaveBeenCalled();
    expect(cerrarVigenteMock).not.toHaveBeenCalled();
  });

  it("refuses a costo that is no longer vigente (replaced or already given de baja): it is never closed twice (R23)", async () => {
    state.costoBloqueado = costoBloqueado({ vigenteHasta: new Date("2026-10-01T00:00:00.000Z") });

    const error = await baja({ costoProveedorId: COSTO_ID, motivo: "x" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toMatch(/ya no está vigente/);
    expect(cerrarVigenteMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("refuses a costo that does not exist", async () => {
    state.costoBloqueado = null;

    await expect(baja({ costoProveedorId: COSTO_ID, motivo: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect(cerrarVigenteMock).not.toHaveBeenCalled();
  });
});
