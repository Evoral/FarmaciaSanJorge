/**
 * Unit tests for `leerListaPrecios` (docs/specs/costos-proveedor.md R13-R18, R21): the read step that writes NOTHING. The repository is
 * mocked; the file validation, the workbook reader (exceljs, on workbooks built here) and the domain are the real ones.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";

const {
  TENANT_ID,
  PROVEEDOR_ID,
  DROGA_ID,
  UNIDAD_KG_ID,
  state,
  auditRecordMock,
  getContextoTemporalMock,
  getProveedorParaCostoMock,
  buscarListaPorHashMock,
  listAliasesVigentesParaListaMock,
  listDrogasVigentesParaListaMock,
  listUnidadesParaListaMock,
  getCostosVigentesDeProveedorMock,
} = vi.hoisted(() => {
  const TENANT_ID = "11111111-1111-1111-1111-111111111111";
  const PROVEEDOR_ID = "33333333-3333-4333-a333-333333333333";
  const DROGA_ID = "44444444-4444-4444-a444-444444444444";
  const UNIDAD_KG_ID = "66666666-6666-4666-a666-666666666666";
  const UNIDAD_MG_ID = "88888888-8888-4888-a888-888888888888";

  const state = {
    proveedor: { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: null as Date | null } as { id: string; razonSocial: string; fechaBaja: Date | null } | null,
    listaExistente: null as { id: string; registradoEn: Date } | null,
    aliases: [] as { aliasNormalizado: string; drogaId: string }[],
    vigentes: [] as unknown[],
  };

  return {
    TENANT_ID,
    PROVEEDOR_ID,
    DROGA_ID,
    UNIDAD_KG_ID,
    state,
    auditRecordMock: vi.fn(async (...args: unknown[]) => void args),
    getContextoTemporalMock: vi.fn(async () => ({ jornadaActual: "2026-10-15", zonaHoraria: "America/Argentina/Mendoza" })),
    getProveedorParaCostoMock: vi.fn(async () => state.proveedor),
    buscarListaPorHashMock: vi.fn(async () => state.listaExistente),
    listAliasesVigentesParaListaMock: vi.fn(async () => state.aliases),
    listDrogasVigentesParaListaMock: vi.fn(async () => [
      { id: DROGA_ID, nombre: "Aceite de girasol", tipoMagnitud: "MASA", unidadBaseId: UNIDAD_MG_ID },
      { id: "55555555-5555-4555-a555-555555555555", nombre: "Zinc sulfato 7 H2O", tipoMagnitud: "MASA", unidadBaseId: UNIDAD_MG_ID },
    ]),
    listUnidadesParaListaMock: vi.fn(async () => [
      { id: UNIDAD_KG_ID, codigo: "KILOGRAMO", simbolo: "kg", tipoMagnitud: "MASA", factorABase: "1000", vigente: true },
      { id: UNIDAD_MG_ID, codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factorABase: "0.001", vigente: true },
    ]),
    getCostosVigentesDeProveedorMock: vi.fn(async () => state.vigentes),
  };
});

vi.mock("@/shared/audit", () => ({
  record: auditRecordMock,
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

vi.mock("@/modules/costos-proveedor/infrastructure/costo-proveedor-repository", () => ({
  getContextoTemporal: getContextoTemporalMock,
  getProveedorParaCosto: getProveedorParaCostoMock,
  buscarListaPorHash: buscarListaPorHashMock,
  listAliasesVigentesParaLista: listAliasesVigentesParaListaMock,
  listDrogasVigentesParaLista: listDrogasVigentesParaListaMock,
  listUnidadesParaLista: listUnidadesParaListaMock,
  getCostosVigentesDeProveedor: getCostosVigentesDeProveedorMock,
}));

const { leerListaPreciosQuery } = await import("@/modules/costos-proveedor/application/leer-lista-precios");
const { hashSha256 } = await import("@/modules/costos-proveedor/infrastructure/leer-xlsx.server");

const session: AuthenticatedSession = {
  usuario: { id: "22222222-2222-4222-a222-222222222222", email: "admin@example.com", nombre: "A", apellido: "B" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["costos.proveedor.gestionar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The dated sheets of the real list, newest last, with an empty one in the middle. */
async function libro(): Promise<Uint8Array<ArrayBuffer>> {
  const wb = new ExcelJS.Workbook();
  const agregar = (nombre: string, filas: (string | number | null)[][]) => {
    const hoja = wb.addWorksheet(nombre);
    hoja.addRow(["DESCRIPCION", "PRECIO", "PRECIO mg", "mg C/IVA", "COSTO"]);
    for (const fila of filas) hoja.addRow(fila);
  };
  agregar("11-24", [["ACEITE DE GIRASOL", 1000]]);
  wb.addWorksheet("vacia");
  agregar("04-26", [
    ["ACEITE DE GIRASOL", 1500],
    ["ACEITE DE GIRASOL Tambor X 200", 250000],
    ["ZINC SULFATO 7 H2O", 29801.136000000002],
    ["DROGA QUE NO ESTA", 10],
    [null, "Page 1 of 1"],
  ]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function archivoLibro(nombre = "Lista de medicamentos.xlsx"): Promise<File> {
  return new File([await libro()], nombre, { type: XLSX_MIME });
}

async function leer(cambios: Record<string, unknown> = {}) {
  return leerListaPreciosQuery.execute({ proveedorId: PROVEEDOR_ID, fechaLista: "2026-10-10", archivo: await archivoLibro(), ...cambios }, { session });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.proveedor = { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: null };
  state.listaExistente = null;
  state.aliases = [];
  state.vigentes = [];
});

describe("leerListaPrecios -- the preview", () => {
  it("opens the LAST sheet with data, with the other sheets listed (the empty one flagged)", async () => {
    const vista = await leer();

    expect(vista.hoja).toBe("04-26");
    expect(vista.hojas).toEqual([
      { nombre: "11-24", vacia: false },
      { nombre: "vacia", vacia: true },
      { nombre: "04-26", vacia: false },
    ]);
  });

  it("reads another sheet when asked: the SAME file, a different sheet", async () => {
    const vista = await leer({ hoja: "11-24" });

    expect(vista.hoja).toBe("11-24");
    expect(vista.filas.map((f) => [f.descripcion, f.precio])).toEqual([["ACEITE DE GIRASOL", "1000"]]);
  });

  it("builds the rows: matched by name, the presentation omitted, the unmatched left without droga, the footer discarded", async () => {
    const vista = await leer();

    expect(vista.filasLeidas).toBe(4);
    expect(vista.descartadas).toBe(1);
    expect(vista.filas.map((f) => [f.numeroFila, f.descripcion, f.precio, f.estado, f.drogaNombre])).toEqual([
      [2, "ACEITE DE GIRASOL", "1500", "ASOCIADA", "Aceite de girasol"],
      [3, "ACEITE DE GIRASOL Tambor X 200", "250000", "OMITIDA_PRESENTACION", null],
      [4, "ZINC SULFATO 7 H2O", "29801.136", "ASOCIADA", "Zinc sulfato 7 H2O"],
      [5, "DROGA QUE NO ESTA", "10", "SIN_ASOCIAR", null],
    ]);
    expect(vista.filas[0]).toMatchObject({ unidadPrecioId: UNIDAD_KG_ID, via: "NOMBRE" });
    expect(vista.resumen).toMatchObject({ ASOCIADA: 2, OMITIDA_PRESENTACION: 1, SIN_ASOCIAR: 1 });
  });

  it("carries what the form needs to re-evaluate: the proveedor, the fecha, the file's name and SHA-256, the vigentes", async () => {
    state.vigentes = [{ id: "v-1", drogaId: DROGA_ID, precioInformado: "1000", unidadPrecioId: UNIDAD_KG_ID, unidadPrecioSimbolo: "kg", costoUnitario: "0.001", fechaPrecio: "2026-09-01" }];

    const vista = await leer();

    expect(vista).toMatchObject({
      proveedor: { id: PROVEEDOR_ID, razonSocial: "Droguería Sur" },
      fechaLista: "2026-10-10",
      nombreArchivo: "Lista de medicamentos.xlsx",
      formato: "XLSX",
    });
    expect(vista.hashSha256).toBe(hashSha256(await libro()));
    expect(vista.vigentes).toHaveLength(1);
    expect(vista.filas[0]).toMatchObject({ vigente: { id: "v-1" }, variacionPct: "50.0", variacionAlta: false });
  });

  it("looks the synonyms up for the texts of the base rows only", async () => {
    await leer();

    const consultados = (listAliasesVigentesParaListaMock.mock.calls[0] as unknown as [unknown, string, string[]])[2];
    expect(consultados).toEqual(["aceite de girasol", "zinc sulfato 7 h2o", "droga que no esta"]);
  });

  it("writes nothing: no audit record", async () => {
    await leer();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("keeps only the file's own name, without any path", async () => {
    const vista = await leer({ archivo: await archivoLibro("C:\\Users\\ana\\Descargas\\Lista de medicamentos.xlsx") });
    expect(vista.nombreArchivo).toBe("Lista de medicamentos.xlsx");
  });
});

describe("leerListaPrecios -- refusals (R15, R21)", () => {
  it("refuses a file already imported for the proveedor, with the date (R21)", async () => {
    state.listaExistente = { id: "l-1", registradoEn: new Date("2026-10-12T15:00:00.000Z") };

    const error = await leer().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("Esta lista ya fue importada para este proveedor el 12/10/2026.");
    expect(buscarListaPorHashMock.mock.calls[0]!.slice(1, 3)).toEqual([TENANT_ID, PROVEEDOR_ID]);
  });

  it("refuses a fecha de la lista after the jornada, pointing at the field", async () => {
    const error = await leer({ fechaLista: "2026-10-16" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["fechaLista"]);
  });

  it("refuses an unknown proveedor and one dado de baja", async () => {
    state.proveedor = null;
    await expect(leer()).rejects.toBeInstanceOf(NotFoundError);

    state.proveedor = { id: PROVEEDOR_ID, razonSocial: "Droguería Sur", fechaBaja: new Date("2026-01-01T00:00:00Z") };
    await expect(leer()).rejects.toBeInstanceOf(DomainError);
  });

  it("refuses a legacy .xls with its own message, and what is not a file at all", async () => {
    const xls = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])], "lista.xls", { type: "application/vnd.ms-excel" });
    await expect(leer({ archivo: xls })).rejects.toThrow("Es un archivo .xls (Excel 97-2003). Abrilo en Excel y guardalo como .xlsx.");
    await expect(leer({ archivo: "texto" })).rejects.toBeInstanceOf(ValidationError);
    await expect(leer({ archivo: undefined })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a sheet that does not exist and a workbook that is not readable", async () => {
    await expect(leer({ hoja: "99-99" })).rejects.toThrow(/La hoja «99-99» no existe/);

    const corrupto = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(300).fill(7)])], "lista.xlsx", { type: XLSX_MIME });
    await expect(leer({ archivo: corrupto })).rejects.toThrow("No se pudo leer el archivo: no parece un .xlsx válido.");
  });

  it("refuses a sheet that is not the supplier's layout (no DESCRIPCION/PRECIO header)", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").addRow(["nombre", "valor"]);
    const archivo = new File([new Uint8Array(await wb.xlsx.writeBuffer())], "otra.xlsx", { type: XLSX_MIME });

    await expect(leer({ archivo })).rejects.toThrow(/encabezado/);
  });

  it("refuses a workbook with no data in any sheet", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("vacia");
    const archivo = new File([new Uint8Array(await wb.xlsx.writeBuffer())], "vacio.xlsx", { type: XLSX_MIME });

    await expect(leer({ archivo })).rejects.toThrow("El archivo no tiene ninguna hoja con datos.");
  });

  it("never reaches the database when the file itself is refused", async () => {
    await expect(leer({ archivo: "texto" })).rejects.toBeInstanceOf(ValidationError);
    expect(getContextoTemporalMock).not.toHaveBeenCalled();
  });
});
