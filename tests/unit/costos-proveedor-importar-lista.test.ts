/**
 * Unit tests for `importarListaPrecios` (openspec/specs/costos-proveedor/spec.md R13, R20-R23; CP8, CP9, CP10). The repository is mocked, the
 * domain and `registrarFilasEnTx` are the real ones: what is under test is the command's ALL-OR-NOTHING order (the lista header is
 * inserted only after every row passed, with the final `filas_aplicadas`), the dating of every row with the list's date, the
 * duplicate-file refusal, the optimistic conflict and "recordar equivalencia".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, ValidationError } from "@/shared/errors";

const {
  TENANT_ID,
  USUARIO_ID,
  PROVEEDOR_ID,
  DROGA_ID,
  DROGA_2_ID,
  DROGA_3_ID,
  UNIDAD_KG_ID,
  UNIDAD_L_ID,
  COSTO_ID,
  LISTA_ID,
  ALIAS_ID,
  AHORA,
  HASH,
  callOrder,
  state,
  auditRecordMock,
  withTenantTransactionMock,
  getContextoTemporalMock,
  jornadaActualTenantMock,
  getProveedorParaCostoMock,
  getDrogasParaCostoMock,
  getUnidadesParaCostoMock,
  lockVigentesMock,
  cerrarVigenteMock,
  insertCostoProveedorMock,
  ahoraServidorMock,
  buscarListaPorHashMock,
  insertListaPrecioProveedorMock,
  getDrogaAliasMock,
  insertDrogaAliasMock,
} = vi.hoisted(() => {
  const TENANT_ID = "11111111-1111-1111-1111-111111111111";
  const USUARIO_ID = "22222222-2222-4222-a222-222222222222";
  const PROVEEDOR_ID = "33333333-3333-4333-a333-333333333333";
  const DROGA_ID = "44444444-4444-4444-a444-444444444444";
  const DROGA_2_ID = "55555555-5555-4555-a555-555555555555";
  const DROGA_3_ID = "cccccccc-cccc-4ccc-accc-cccccccccccc";
  const UNIDAD_KG_ID = "66666666-6666-4666-a666-666666666666";
  const UNIDAD_MG_ID = "88888888-8888-4888-a888-888888888888";
  const UNIDAD_L_ID = "99999999-9999-4999-a999-999999999999";
  const UNIDAD_ML_ID = "dddddddd-dddd-4ddd-addd-dddddddddddd";
  const COSTO_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const LISTA_ID = "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee";
  const ALIAS_ID = "ffffffff-ffff-4fff-afff-ffffffffffff";
  const AHORA = new Date("2026-10-15T12:00:00.000Z");
  const HASH = "a".repeat(64);
  const callOrder: string[] = [];

  const unidades = new Map([
    [UNIDAD_KG_ID, { id: UNIDAD_KG_ID, codigo: "KILOGRAMO", simbolo: "kg", tipoMagnitud: "MASA", factorABase: "1000", fechaBaja: null as Date | null }],
    [UNIDAD_MG_ID, { id: UNIDAD_MG_ID, codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factorABase: "0.001", fechaBaja: null as Date | null }],
    [UNIDAD_L_ID, { id: UNIDAD_L_ID, codigo: "LITRO", simbolo: "L", tipoMagnitud: "VOLUMEN", factorABase: "1000", fechaBaja: null as Date | null }],
    [UNIDAD_ML_ID, { id: UNIDAD_ML_ID, codigo: "MILILITRO", simbolo: "mL", tipoMagnitud: "VOLUMEN", factorABase: "1", fechaBaja: null as Date | null }],
  ]);
  const drogas = new Map([
    [DROGA_ID, { id: DROGA_ID, nombre: "Paracetamol", fechaBaja: null as Date | null, unidadBaseId: UNIDAD_MG_ID }],
    [DROGA_2_ID, { id: DROGA_2_ID, nombre: "Ibuprofeno", fechaBaja: null as Date | null, unidadBaseId: UNIDAD_MG_ID }],
    [DROGA_3_ID, { id: DROGA_3_ID, nombre: "Aceite de girasol", fechaBaja: null as Date | null, unidadBaseId: UNIDAD_ML_ID }],
  ]);

  const state = {
    unidades,
    drogas,
    proveedor: { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: null as Date | null } as { id: string; razonSocial: string; fechaBaja: Date | null } | null,
    vigentes: [] as unknown[],
    listaExistente: null as { id: string; registradoEn: Date } | null,
    /** What `getDrogaAlias` answers per normalized text (absent = free). */
    aliases: new Map<string, { id: string; drogaId: string; esNombre?: boolean }>(),
    insertListaError: null as unknown,
  };

  return {
    TENANT_ID,
    USUARIO_ID,
    PROVEEDOR_ID,
    DROGA_ID,
    DROGA_2_ID,
    DROGA_3_ID,
    UNIDAD_KG_ID,
    UNIDAD_L_ID,
    COSTO_ID,
    LISTA_ID,
    ALIAS_ID,
    AHORA,
    HASH,
    callOrder,
    state,
    auditRecordMock: vi.fn(async (...args: unknown[]) => void args),
    withTenantTransactionMock: vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId })),
    getContextoTemporalMock: vi.fn(async () => ({ jornadaActual: "2026-10-15", zonaHoraria: "America/Argentina/Mendoza" })),
    jornadaActualTenantMock: vi.fn(async () => "2026-10-15"),
    getProveedorParaCostoMock: vi.fn(async () => state.proveedor),
    getDrogasParaCostoMock: vi.fn(async (_tx: unknown, _tenantId: string, ids: readonly string[]) => new Map([...state.drogas].filter(([id]) => ids.includes(id)))),
    getUnidadesParaCostoMock: vi.fn(async (_tx: unknown, ids: readonly string[]) => new Map([...state.unidades].filter(([id]) => ids.includes(id)))),
    lockVigentesMock: vi.fn(async () => {
      callOrder.push("lock");
      return state.vigentes;
    }),
    cerrarVigenteMock: vi.fn(async (...args: unknown[]) => {
      void args;
      callOrder.push("cerrar");
    }),
    insertCostoProveedorMock: vi.fn(async (...args: unknown[]) => {
      void args;
      callOrder.push("costo");
      return { id: `costo-${callOrder.length}` };
    }),
    ahoraServidorMock: vi.fn(async () => AHORA),
    buscarListaPorHashMock: vi.fn(async () => state.listaExistente),
    insertListaPrecioProveedorMock: vi.fn(async (...args: unknown[]) => {
      void args;
      callOrder.push("lista");
      if (state.insertListaError) throw state.insertListaError;
      return { id: LISTA_ID };
    }),
    getDrogaAliasMock: vi.fn(async (_tx: unknown, _tenantId: string, alias: string) => state.aliases.get(alias) ?? null),
    insertDrogaAliasMock: vi.fn(async (...args: unknown[]) => {
      void args;
      callOrder.push("alias");
      return { id: ALIAS_ID };
    }),
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
  getContextoTemporal: getContextoTemporalMock,
  jornadaActualTenant: jornadaActualTenantMock,
  getProveedorParaCosto: getProveedorParaCostoMock,
  getDrogasParaCosto: getDrogasParaCostoMock,
  getUnidadesParaCosto: getUnidadesParaCostoMock,
  lockVigentes: lockVigentesMock,
  cerrarVigente: cerrarVigenteMock,
  insertCostoProveedor: insertCostoProveedorMock,
  ahoraServidor: ahoraServidorMock,
  buscarListaPorHash: buscarListaPorHashMock,
  insertListaPrecioProveedor: insertListaPrecioProveedorMock,
  getDrogaAlias: getDrogaAliasMock,
  insertDrogaAlias: insertDrogaAliasMock,
}));

const { importarListaPreciosCommand } = await import("@/modules/costos-proveedor/application/importar-lista-precios");

const session: AuthenticatedSession = {
  usuario: { id: USUARIO_ID, email: "admin@example.com", nombre: "A", apellido: "B" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["costos.proveedor.gestionar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

const FECHA_LISTA = "2026-10-10";

/** A kept row as the form sends it: Paracetamol, 40.898 $/kg, row 57 of the sheet, no vigente seen. */
function fila(cambios: Record<string, unknown> = {}) {
  return {
    drogaId: DROGA_ID,
    precioInformado: "40898",
    unidadPrecioId: UNIDAD_KG_ID,
    descripcionProveedor: "PARACETAMOL",
    vigenteEsperadoId: null,
    numeroFila: 57,
    ...cambios,
  };
}

function lista(filas: unknown[], cambios: Record<string, unknown> = {}) {
  return {
    proveedorId: PROVEEDOR_ID,
    fechaLista: FECHA_LISTA,
    nombreArchivo: "Lista de medicamentos.xlsx",
    hashSha256: HASH,
    formato: "XLSX",
    filasLeidas: 900,
    filas,
    ...cambios,
  };
}

function importar(input: unknown) {
  return importarListaPreciosCommand.execute(input, { session });
}

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

/** Nothing at all was written: no lista header, no costo, no closing, no synonym, no audit. */
function sinEscrituras() {
  expect(insertListaPrecioProveedorMock).not.toHaveBeenCalled();
  expect(insertCostoProveedorMock).not.toHaveBeenCalled();
  expect(cerrarVigenteMock).not.toHaveBeenCalled();
  expect(insertDrogaAliasMock).not.toHaveBeenCalled();
  expect(auditRecordMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  state.vigentes = [];
  state.listaExistente = null;
  state.aliases = new Map();
  state.insertListaError = null;
  state.proveedor = { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: null };
  for (const droga of state.drogas.values()) droga.fechaBaja = null;
  for (const unidad of state.unidades.values()) unidad.fechaBaja = null;
});

describe("importarListaPrecios -- the happy path", () => {
  it("inserts the lista header ONCE, after every row passed and before the first costo, then the costos dated with the list's date (R13, R20)", async () => {
    const resultado = await importar(lista([fila(), fila({ drogaId: DROGA_2_ID, precioInformado: "1200", numeroFila: 58 })]));

    expect(resultado).toMatchObject({ listaPrecioId: LISTA_ID, insertados: 2, reemplazados: 0, sinCambios: 0, equivalencias: 0 });
    expect(callOrder).toEqual(["lock", "lista", "costo", "costo"]);

    expect(insertListaPrecioProveedorMock).toHaveBeenCalledTimes(1);
    expect(insertListaPrecioProveedorMock.mock.calls[0]![1]).toEqual({
      tenantId: TENANT_ID,
      proveedorId: PROVEEDOR_ID,
      formato: "XLSX",
      nombreArchivo: "Lista de medicamentos.xlsx",
      hashSha256: HASH,
      fechaLista: FECHA_LISTA,
      filasLeidas: 900,
      filasAplicadas: 2,
      registradoPorId: USUARIO_ID,
    });

    expect(insertCostoProveedorMock).toHaveBeenCalledTimes(2);
    for (const llamada of insertCostoProveedorMock.mock.calls) {
      // Every row is dated with the LIST's date and points at the header; costo per mg: 40.898 $/kg = 0,040898.
      expect(llamada[1]).toMatchObject({ fechaPrecio: FECHA_LISTA, listaPrecioId: LISTA_ID, vigenteDesde: AHORA, creadoPorId: USUARIO_ID, descripcionProveedor: expect.any(String) });
    }
    expect(insertCostoProveedorMock.mock.calls[0]![1]).toMatchObject({ drogaId: DROGA_ID, costoUnitario: "0.040898", descripcionProveedor: "PARACETAMOL" });
  });

  it("audits the lista header (entity lista_precio_proveedor) and every costo, inside the same transaction", async () => {
    await importar(lista([fila()]));

    const auditorias = auditRecordMock.mock.calls.map((call) => call[1] as Record<string, unknown>);
    const cabecera = auditorias.find((a) => a.entidad === "lista_precio_proveedor")!;
    expect(cabecera).toMatchObject({ entidadId: LISTA_ID, accion: "CREAR", tenantId: TENANT_ID, usuarioId: USUARIO_ID, contexto: { origen: "importacion_lista_precios" } });
    expect(cabecera.valorNuevo).toEqual({
      proveedor: "Droguería Sur",
      formato: "XLSX",
      nombreArchivo: "Lista de medicamentos.xlsx",
      hashSha256: HASH,
      fechaLista: FECHA_LISTA,
      filasLeidas: 900,
      filasAplicadas: 1,
    });
    expect(auditorias.filter((a) => a.entidad === "costo_proveedor")).toHaveLength(1);
    expect(auditorias[auditorias.length - 1]!.contexto).toEqual({ origen: "importacion_lista_precios" });
    expect(withTenantTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("closes the vigente and replaces it with the SAME instant; the version keeps the list's text and date (R2)", async () => {
    state.vigentes = [vigente()];

    const resultado = await importar(lista([fila({ vigenteEsperadoId: COSTO_ID })]));

    expect(resultado).toMatchObject({ insertados: 0, reemplazados: 1 });
    expect(callOrder).toEqual(["lock", "lista", "cerrar", "costo"]);
    expect(cerrarVigenteMock.mock.calls[0]![3]).toBe((insertCostoProveedorMock.mock.calls[0]![1] as { vigenteDesde: Date }).vigenteDesde);
  });

  it("filas_aplicadas counts the costos really written: a row that turns out sin cambios is not applied (R10)", async () => {
    state.vigentes = [vigente({ precioInformado: "40898", fechaPrecio: FECHA_LISTA })];

    const resultado = await importar(lista([fila({ vigenteEsperadoId: COSTO_ID }), fila({ drogaId: DROGA_2_ID, precioInformado: "1200", numeroFila: 58 })]));

    expect(resultado).toMatchObject({ insertados: 1, sinCambios: 1 });
    expect(insertListaPrecioProveedorMock.mock.calls[0]![1]).toMatchObject({ filasLeidas: 900, filasAplicadas: 1 });
    expect(insertCostoProveedorMock).toHaveBeenCalledTimes(1);
  });

  it("only touches the rows it was given: a droga absent from the list keeps its vigente (R22)", async () => {
    await importar(lista([fila()]));

    // The only pair locked and written is the one in the list.
    expect((lockVigentesMock.mock.calls[0] as unknown[])[2]).toEqual([{ drogaId: DROGA_ID, proveedorId: PROVEEDOR_ID }]);
    expect(cerrarVigenteMock).not.toHaveBeenCalled();
  });

  it("works with a unit of another droga's magnitud picked per row: a volumen droga in L", async () => {
    await importar(lista([fila({ drogaId: DROGA_3_ID, unidadPrecioId: UNIDAD_L_ID, precioInformado: "1500", numeroFila: 60 })]));
    // 1.500 $/L per mL.
    expect(insertCostoProveedorMock.mock.calls[0]![1]).toMatchObject({ drogaId: DROGA_3_ID, costoUnitario: "1.5" });
  });
});

describe("importarListaPrecios -- all or nothing (R20, CP8)", () => {
  it("ONE invalid row rejects the whole import: no lista, no costos, no audit; the row is marked and named by its sheet row number", async () => {
    const error = await importar(lista([fila(), fila({ drogaId: DROGA_2_ID, precioInformado: "0", numeroFila: 311 })])).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["filas.1.precioInformado"]);
    expect((error as ValidationError).message).toMatch(/^Fila 311:/);
    sinEscrituras();
    expect(lockVigentesMock).not.toHaveBeenCalled();
  });

  it("a row whose price is older than the vigente's also rejects everything, header included (R9)", async () => {
    state.vigentes = [vigente({ fechaPrecio: "2026-10-12" })];

    const error = await importar(lista([fila({ drogaId: DROGA_2_ID, numeroFila: 58 }), fila({ vigenteEsperadoId: COSTO_ID })])).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["filas.1.fechaPrecio"]);
    expect(lockVigentesMock).toHaveBeenCalledTimes(1);
    sinEscrituras();
  });

  it("a droga repeated in the kept rows rejects everything, marking both", async () => {
    const error = await importar(lista([fila(), fila({ precioInformado: "41000", numeroFila: 58 })])).catch((e: unknown) => e);

    expect((error as ValidationError).fields).toEqual(["filas.0.drogaId", "filas.1.drogaId"]);
    sinEscrituras();
  });

  it("a droga or a proveedor de baja rejects everything", async () => {
    state.drogas.get(DROGA_2_ID)!.fechaBaja = new Date("2026-01-01T00:00:00Z");
    const droga = await importar(lista([fila(), fila({ drogaId: DROGA_2_ID, numeroFila: 58 })])).catch((e: unknown) => e);
    expect((droga as ValidationError).fields).toEqual(["filas.1.drogaId"]);
    sinEscrituras();

    state.drogas.get(DROGA_2_ID)!.fechaBaja = null;
    state.proveedor = { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: new Date("2026-01-01T00:00:00Z") };
    await expect(importar(lista([fila()]))).rejects.toBeInstanceOf(DomainError);
    sinEscrituras();
  });

  it("a unit of another magnitud than the droga's rejects everything (R5)", async () => {
    const error = await importar(lista([fila({ unidadPrecioId: UNIDAD_L_ID })])).catch((e: unknown) => e);
    expect((error as ValidationError).fields).toEqual(["filas.0.unidadPrecioId"]);
    sinEscrituras();
  });

  it("nothing is written either when the failure happens while writing the header: the rows were not inserted", async () => {
    state.insertListaError = new Error("boom");

    await expect(importar(lista([fila()]))).rejects.toThrow();

    expect(insertCostoProveedorMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });
});

describe("importarListaPrecios -- the same file twice (R21, CP9)", () => {
  it("refuses a file already imported for the proveedor, with the date of that import, before writing anything", async () => {
    state.listaExistente = { id: LISTA_ID, registradoEn: new Date("2026-10-12T15:00:00.000Z") };

    const error = await importar(lista([fila()])).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("Esta lista ya fue importada para este proveedor el 12/10/2026.");
    expect(buscarListaPorHashMock.mock.calls[0]!.slice(1)).toEqual([TENANT_ID, PROVEEDOR_ID, HASH]);
    sinEscrituras();
    expect(lockVigentesMock).not.toHaveBeenCalled();
  });

  it("two confirmations racing: the DB unique on the hash becomes the friendly message, not 'Ya existe un registro con esos mismos datos'", async () => {
    state.insertListaError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

    const error = await importar(lista([fila()])).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("Esta lista ya fue importada para este proveedor.");
    expect(insertCostoProveedorMock).not.toHaveBeenCalled();
  });
});

describe("importarListaPrecios -- the vigente changed while reviewing (R23, CP10)", () => {
  it("refuses the whole confirmation, saying to read the file again, and writes nothing", async () => {
    state.vigentes = [vigente({ id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" })];

    const error = await importar(lista([fila({ vigenteEsperadoId: COSTO_ID })])).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("El costo de Paracetamol cambió mientras revisabas la lista. Volvé a leer el archivo.");
    expect((error as DomainError).fields).toEqual(["filas.0.drogaId"]);
    expect(callOrder).toEqual(["lock"]);
    sinEscrituras();
  });

  it("also when the user saw NO vigente and one appeared", async () => {
    state.vigentes = [vigente()];
    await expect(importar(lista([fila({ vigenteEsperadoId: null })]))).rejects.toThrow(/revisabas la lista/);
    sinEscrituras();
  });
});

describe("importarListaPrecios -- the list's own fields", () => {
  it("rejects a fecha de la lista after the jornada, pointing at the field, before anything else", async () => {
    const error = await importar(lista([fila()], { fechaLista: "2026-10-16" })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["fechaLista"]);
    expect((error as ValidationError).message).toMatch(/posterior a hoy/);
    expect(buscarListaPorHashMock).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("rejects an impossible date", async () => {
    const error = await importar(lista([fila()], { fechaLista: "2026-02-31" })).catch((e: unknown) => e);
    expect((error as ValidationError).fields).toEqual(["fechaLista"]);
  });

  it("rejects more kept rows than rows read (the DB CHECK filas_aplicadas <= filas_leidas, with a message instead)", async () => {
    const error = await importar(lista([fila(), fila({ drogaId: DROGA_2_ID, numeroFila: 58 })], { filasLeidas: 1 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    sinEscrituras();
  });

  it("refuses a row that does not say which vigente it was compared against: the optimistic check (R23) is never skipped by omission", async () => {
    const { vigenteEsperadoId: _omitido, ...sinEsperado } = fila();
    void _omitido;

    const error = await importar(lista([fila(), sinEsperado])).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["filas.1.vigenteEsperadoId"]);
    sinEscrituras();
  });

  it("records the format the list was read from: XLS (a .xls import) as well as XLSX", async () => {
    await importar(lista([fila()], { formato: "XLS", nombreArchivo: "Lista de medicamentos.xls" }));

    expect(insertListaPrecioProveedorMock.mock.calls[0]![1]).toMatchObject({ formato: "XLS", nombreArchivo: "Lista de medicamentos.xls" });
    const cabecera = auditRecordMock.mock.calls.map((call) => call[1] as Record<string, unknown>).find((a) => a.entidad === "lista_precio_proveedor")!;
    expect(cabecera.valorNuevo).toMatchObject({ formato: "XLS", nombreArchivo: "Lista de medicamentos.xls" });
  });

  it("validates the shape of the envelope before touching the database", async () => {
    for (const cambios of [{ hashSha256: "xyz" }, { hashSha256: "A".repeat(64) }, { formato: "PDF" }, { formato: "xls" }, { formato: "XLSM" }, { formato: undefined }, { nombreArchivo: "  " }, { proveedorId: "no-es-uuid" }, { filasLeidas: -1 }]) {
      await expect(importar(lista([fila()], cambios))).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(importar(lista([]))).rejects.toBeInstanceOf(ValidationError);
    expect(getContextoTemporalMock).not.toHaveBeenCalled();
  });
});

describe("importarListaPrecios -- recordar equivalencia (R19)", () => {
  const equivalencia = (cambios: Record<string, unknown> = {}) => fila({ recordarEquivalencia: true, descripcionProveedor: "ACETAMINOFEN  500 ", ...cambios });

  it("saves the list's text as a synonym of the chosen droga, with its own audit record, after the costos", async () => {
    const resultado = await importar(lista([equivalencia()]));

    expect(resultado.equivalencias).toBe(1);
    expect(getDrogaAliasMock.mock.calls[0]!.slice(1)).toEqual([TENANT_ID, "acetaminofen 500"]);
    expect(insertDrogaAliasMock.mock.calls[0]![1]).toEqual({
      tenantId: TENANT_ID,
      drogaId: DROGA_ID,
      aliasNormalizado: "acetaminofen 500",
      texto: "ACETAMINOFEN 500",
      creadoPorId: USUARIO_ID,
    });
    expect(callOrder).toEqual(["lock", "lista", "costo", "alias"]);
    const auditoria = auditRecordMock.mock.calls.map((call) => call[1] as Record<string, unknown>).find((a) => a.entidad === "droga_alias")!;
    expect(auditoria).toMatchObject({ entidadId: ALIAS_ID, accion: "CREAR" });
    expect(auditoria.valorNuevo).toEqual({ sinonimo: "ACETAMINOFEN 500", aliasNormalizado: "acetaminofen 500", drogaId: DROGA_ID, droga: "Paracetamol" });
  });

  it("does nothing for a row not marked to remember", async () => {
    const resultado = await importar(lista([fila(), fila({ drogaId: DROGA_2_ID, numeroFila: 58, recordarEquivalencia: false })]));

    expect(resultado.equivalencias).toBe(0);
    expect(getDrogaAliasMock).not.toHaveBeenCalled();
    expect(insertDrogaAliasMock).not.toHaveBeenCalled();
  });

  it("is idempotent for the same droga, and never saves a text that already is a droga's name", async () => {
    state.aliases.set("acetaminofen 500", { id: ALIAS_ID, drogaId: DROGA_ID });
    state.aliases.set("ibuprofeno", { id: DROGA_2_ID, drogaId: DROGA_2_ID, esNombre: true });

    const resultado = await importar(lista([equivalencia(), equivalencia({ drogaId: DROGA_3_ID, unidadPrecioId: UNIDAD_L_ID, descripcionProveedor: "IBUPROFENO", numeroFila: 58 })]));

    expect(resultado.equivalencias).toBe(0);
    expect(insertDrogaAliasMock).not.toHaveBeenCalled();
  });

  it("refuses when a vigente synonym already points at ANOTHER droga: the whole import is rolled back, the row marked", async () => {
    state.aliases.set("acetaminofen 500", { id: ALIAS_ID, drogaId: DROGA_2_ID });

    const error = await importar(lista([equivalencia()])).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toMatch(/ya está asociado a otra droga/);
    expect((error as DomainError).fields).toEqual(["filas.0.drogaId"]);
    expect(insertDrogaAliasMock).not.toHaveBeenCalled();
  });

  it("saves one synonym per distinct normalized text, even if two rows carry it", async () => {
    // Two rows with the same text for different drogas can not both be remembered: the second is skipped by the repeated key.
    const resultado = await importar(lista([equivalencia(), equivalencia({ drogaId: DROGA_2_ID, numeroFila: 58 })]));

    expect(resultado.equivalencias).toBe(1);
    expect(insertDrogaAliasMock).toHaveBeenCalledTimes(1);
  });

  it("does not remember a text longer than a synonym may be (the row itself is still applied)", async () => {
    const resultado = await importar(lista([equivalencia({ descripcionProveedor: "A".repeat(201) })]));

    expect(resultado).toMatchObject({ insertados: 1, equivalencias: 0 });
    expect(insertDrogaAliasMock).not.toHaveBeenCalled();
  });
});
