/**
 * Receta PDF import through the REAL use-case pipeline, with the
 * repositories, the extractor and the transaction mocked (no DB, no PDF):
 *
 *   - `recetas.importar.leer`: P8's "permiso first" (the file is not even
 *     looked at without `recetas.crear`), the match (P7/P9 wiring) and P6
 *     (duplicate -> error with the existing número interno; the lookup
 *     ignores ANULADA recetas);
 *   - `recetas.importar`: input schema, alta vs. completion of
 *     paciente/médico, DIGITAL_PDF, aliases, one
 *     audit row per affected entity, and the "data changed since reading"
 *     conflicts;
 *   - P10: the archive's eligibility query excludes DIGITAL_PDF.
 *
 * Personal data below is fictitious.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError, ConflictError, DomainError, ValidationError } from "@/shared/errors";
import type { TextItemLite } from "@/modules/recetas/domain/receta-pdf-parser";

const auditRecordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const FAKE_TX = { __fakeTx: true };
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn(FAKE_TX),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const extraerMock = vi.fn();
vi.mock("@/modules/recetas/infrastructure/receta-pdf.server", () => ({
  extraerTextoRecetaPdf: (...args: unknown[]) => extraerMock(...args),
}));

const repo = {
  buscarRecetaImportada: vi.fn(),
  buscarPacientePorIdentificacion: vi.fn(),
  buscarMedicoVigentePorMatricula: vi.fn(),
  completarPaciente: vi.fn(),
  completarMedico: vi.fn(),
  listAliasesVigentes: vi.fn(),
  listDrogasVigentesParaMatch: vi.fn(),
  listUnidadesVigentesParaMatch: vi.fn(),
  getDrogaAlias: vi.fn(),
  insertDrogaAlias: vi.fn(),
};
vi.mock("@/modules/recetas/infrastructure/importacion-repository", () => ({
  buscarRecetaImportada: (...a: unknown[]) => repo.buscarRecetaImportada(...a),
  buscarPacientePorIdentificacion: (...a: unknown[]) => repo.buscarPacientePorIdentificacion(...a),
  buscarMedicoVigentePorMatricula: (...a: unknown[]) => repo.buscarMedicoVigentePorMatricula(...a),
  completarPaciente: (...a: unknown[]) => repo.completarPaciente(...a),
  completarMedico: (...a: unknown[]) => repo.completarMedico(...a),
  listAliasesVigentes: (...a: unknown[]) => repo.listAliasesVigentes(...a),
  listDrogasVigentesParaMatch: (...a: unknown[]) => repo.listDrogasVigentesParaMatch(...a),
  listUnidadesVigentesParaMatch: (...a: unknown[]) => repo.listUnidadesVigentesParaMatch(...a),
  getDrogaAlias: (...a: unknown[]) => repo.getDrogaAlias(...a),
  insertDrogaAlias: (...a: unknown[]) => repo.insertDrogaAlias(...a),
}));

const insertRecetaMock = vi.fn();
vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  drogasInvalidas: async () => [],
  unidadesInvalidas: async () => [],
  jornadaActualTenant: async () => "2026-09-29",
  insertRecetaConItems: (...a: unknown[]) => insertRecetaMock(...a),
  getNombresParaResumen: async () => ({ drogas: new Map([[DROGA_ID, "Cafeína"]]), unidades: new Map([[UNIDAD_ID, "mg"]]) }),
}));

const insertPacienteMock = vi.fn(async (...a: unknown[]) => {
  void a;
  return { id: "33333333-3333-4333-a333-333333333333" };
});
vi.mock("@/modules/pacientes/infrastructure/paciente-repository", () => ({
  existeCuil: async () => false,
  insertPaciente: (...a: unknown[]) => insertPacienteMock(...a),
}));

const insertMedicoMock = vi.fn(async (...a: unknown[]) => {
  void a;
  return { id: "44444444-4444-4444-a444-444444444444" };
});
vi.mock("@/modules/medicos/infrastructure/medico-repository", () => ({
  existeMatriculaVigente: async () => false,
  insertMedico: (...a: unknown[]) => insertMedicoMock(...a),
}));

const { leerRecetaPdfQuery } = await import("@/modules/recetas/application/leer-receta-pdf");
const { importarRecetaCommand, importarRecetaInput } = await import("@/modules/recetas/application/importar-receta");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const PACIENTE_ID = "22222222-2222-4222-a222-222222222222";
const DROGA_ID = "55555555-5555-4555-a555-555555555555";
const OTRA_DROGA_ID = "66666666-6666-4666-a666-666666666666";
const UNIDAD_ID = "77777777-7777-4777-a777-777777777777";
const CUIL = "27289991110"; // fictitious, valid check digit

function session(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}
const CON_PERMISO = session(["recetas.crear"]);

// ----------------------------------------------------------------------------
// A synthetic RCTA receta, as the extractor would return it (fictitious data).
// ----------------------------------------------------------------------------
function renglon(texto: string, x: number, y: number, height = 11): TextItemLite[] {
  let cursor = x;
  return texto.split(" ").map((str) => {
    const item = { str, x: cursor, y, width: str.length * height * 0.45, height };
    cursor += item.width + 2.5;
    return item;
  });
}

function recetaExtraida() {
  const items: TextItemLite[] = [
    { str: "0200012345678", x: 34, y: 29, width: 80, height: 15 },
    ...renglon("Martín Ríos", 197, 48),
    ...renglon("MÉDICO - MEDICINA GENERAL", 161, 58),
    ...renglon("Creada: 19/08/2026", 348, 58),
    ...renglon("Matrícula Prov.:5120", 184, 68),
    ...renglon("Paciente: Ana Suárez", 27, 82),
    ...renglon(`DNI: 28999111 | CUIL: ${CUIL}`, 27, 94),
    ...renglon("F. Nacimiento: 05/03/1981", 320, 94),
    ...renglon("Rp./", 27, 144, 13.7),
    ...renglon("Cafeína 50 mg", 27, 159, 13.7),
    ...renglon("Cafeinna 10 mg", 27, 170, 13.7),
    ...renglon("30 comprimidos", 27, 181, 13.7),
    ...renglon("Diagnóstico: E66.0 - OBESIDAD", 27, 192, 13.7),
  ];
  return { pages: [items], links: [{ uri: "https://verumrp.com.ar/prescripcion/TESTHASH0001" }] };
}

function pdfFile(): File {
  return new File([new TextEncoder().encode("%PDF-1.7\n%%EOF\n")], "receta.pdf", { type: "application/pdf" });
}

beforeEach(() => {
  auditRecordMock.mockClear();
  extraerMock.mockReset().mockResolvedValue(recetaExtraida());
  for (const fn of Object.values(repo)) fn.mockReset();
  repo.buscarRecetaImportada.mockResolvedValue(null);
  repo.buscarPacientePorIdentificacion.mockResolvedValue(null);
  repo.buscarMedicoVigentePorMatricula.mockResolvedValue(null);
  repo.completarPaciente.mockImplementation(async (_tx: unknown, _t: unknown, _id: unknown, valores: unknown) => valores);
  repo.completarMedico.mockImplementation(async (_tx: unknown, _t: unknown, _id: unknown, valores: unknown) => valores);
  repo.listAliasesVigentes.mockResolvedValue([]);
  repo.listDrogasVigentesParaMatch.mockResolvedValue([{ id: DROGA_ID, nombre: "Cafeína" }]);
  repo.listUnidadesVigentesParaMatch.mockResolvedValue([{ id: UNIDAD_ID, codigo: "MILIGRAMO", simbolo: "mg" }]);
  repo.getDrogaAlias.mockResolvedValue(null);
  repo.insertDrogaAlias.mockResolvedValue({ id: "88888888-8888-4888-a888-888888888888" });
  insertRecetaMock.mockReset().mockResolvedValue({ id: "99999999-9999-4999-a999-999999999999", numeroInterno: "77" });
  insertPacienteMock.mockClear();
  insertMedicoMock.mockClear();
});

// ============================================================================
// recetas.importar.leer
// ============================================================================

describe("recetas.importar.leer -- trust boundary order (P8)", () => {
  it("without recetas.crear the file is rejected by authorize() before it is even checked", async () => {
    const exe = new File([new Uint8Array([0x4d, 0x5a])], "receta.pdf", { type: "application/pdf" });
    await expect(leerRecetaPdfQuery.execute({ archivo: exe }, { session: session([]) })).rejects.toBeInstanceOf(AuthorizationError);
    expect(extraerMock).not.toHaveBeenCalled();
  });

  it("with the permiso, a non-PDF never reaches the extractor", async () => {
    const exe = new File([new Uint8Array([0x4d, 0x5a])], "receta.pdf", { type: "application/pdf" });
    await expect(leerRecetaPdfQuery.execute({ archivo: exe }, { session: CON_PERMISO })).rejects.toBeInstanceOf(ValidationError);
    await expect(leerRecetaPdfQuery.execute({}, { session: CON_PERMISO })).rejects.toBeInstanceOf(ValidationError);
    expect(extraerMock).not.toHaveBeenCalled();
  });

  it("an unrecognized emisor surfaces as a ValidationError, nothing is matched", async () => {
    extraerMock.mockResolvedValue({ ...recetaExtraida(), links: [] });
    await expect(leerRecetaPdfQuery.execute({ archivo: pdfFile() }, { session: CON_PERMISO })).rejects.toThrow("Formato de receta no reconocido.");
    expect(repo.buscarRecetaImportada).not.toHaveBeenCalled();
  });
});

describe("recetas.importar.leer -- match", () => {
  it("existing paciente (by CUIL) with an empty fecha de nacimiento, new médico, one droga matched and one not (P7, P9)", async () => {
    repo.buscarPacientePorIdentificacion.mockResolvedValue({
      id: PACIENTE_ID,
      nombre: "Ana",
      apellido: "Suárez",
      dni: "28999111",
      cuil: CUIL,
      sexo: null,
      fechaNacimiento: null,
      nroCredencial: null,
      fechaBaja: null,
    });

    const vista = await leerRecetaPdfQuery.execute({ archivo: pdfFile() }, { session: CON_PERMISO });

    expect(repo.buscarPacientePorIdentificacion).toHaveBeenCalledWith(FAKE_TX, TENANT_ID, CUIL, "28999111");
    expect(repo.buscarMedicoVigentePorMatricula).toHaveBeenCalledWith(FAKE_TX, TENANT_ID, "PROVINCIAL", "5120");
    expect(vista.paciente).toEqual({
      existente: { id: PACIENTE_ID, nombre: "Ana", apellido: "Suárez", dadoDeBaja: false },
      completar: ["fechaNacimiento"],
      diferencias: [],
    });
    expect(vista.medico.existente).toBeNull();
    expect(vista.componentes).toEqual([
      [
        { drogaId: DROGA_ID, drogaNombre: "Cafeína", via: "NOMBRE", unidadMedidaId: UNIDAD_ID },
        { drogaId: null, drogaNombre: null, via: null, unidadMedidaId: UNIDAD_ID },
      ],
    ]);
    expect(vista.advertencias.map((a) => a.codigo)).toEqual(["DROGA_SIN_MATCH"]);
  });

  it("a paciente dado de baja is still matched, with a warning (never reactivated)", async () => {
    repo.buscarPacientePorIdentificacion.mockResolvedValue({
      id: PACIENTE_ID,
      nombre: "Ana",
      apellido: "Suárez",
      dni: "28999111",
      cuil: CUIL,
      sexo: null,
      fechaNacimiento: "1981-03-05",
      nroCredencial: null,
      fechaBaja: new Date("2026-01-01"),
    });
    const vista = await leerRecetaPdfQuery.execute({ archivo: pdfFile() }, { session: CON_PERMISO });
    expect(vista.paciente.existente?.dadoDeBaja).toBe(true);
    expect(vista.advertencias.map((a) => a.codigo)).toContain("PACIENTE_DADO_DE_BAJA");
  });

  it("P6: an already imported receta is an error naming its número interno, before any preview", async () => {
    repo.buscarRecetaImportada.mockResolvedValue("42");
    await expect(leerRecetaPdfQuery.execute({ archivo: pdfFile() }, { session: CON_PERMISO })).rejects.toThrow(
      new DomainError("Esta receta ya fue cargada (receta interna Nº 42)."),
    );
    expect(repo.buscarPacientePorIdentificacion).not.toHaveBeenCalled();
  });

  it("P6: the duplicate lookup ignores ANULADA recetas (so one anulada por error can be imported again)", async () => {
    const real = await vi.importActual<typeof import("@/modules/recetas/infrastructure/importacion-repository")>(
      "@/modules/recetas/infrastructure/importacion-repository",
    );
    const findFirst = vi.fn(async (...a: unknown[]) => {
      void a;
      return null;
    });
    const numero = await real.buscarRecetaImportada({ receta: { findFirst } } as never, TENANT_ID, "RCTA", "0200012345678");
    expect(numero).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_ID, emisor: "RCTA", nroRecetaEmisor: "0200012345678", estado: { not: "ANULADA" } } }),
    );
  });
});

// ============================================================================
// recetas.importar
// ============================================================================

function payload(overrides: Record<string, unknown> = {}) {
  return {
    emisor: "RCTA",
    nroRecetaEmisor: "0200012345678",
    urlVerificacion: "https://verumrp.com.ar/prescripcion/TESTHASH0001",
    fechaPrescripcion: "2026-08-19",
    fechaValidaDesde: "2026-08-19",
    diagnosticoCodigo: "E66.0",
    diagnosticoDescripcion: "OBESIDAD",
    paciente: { existenteId: PACIENTE_ID, datos: { nombre: "Ana", apellido: "Suárez", dni: "28999111", cuil: CUIL, fechaNacimiento: "1981-03-05" } },
    medico: { existenteId: null, datos: { nombre: "Martín", apellido: "Ríos", matricula: "5120", matriculaJurisdiccion: "PROVINCIAL", especialidad: "MEDICINA GENERAL" } },
    items: [
      {
        formaFarmaceutica: "COMPRIMIDO",
        cantidadUnidades: 30,
        fraccionDosisPorUnidad: "0.5",
        posologia: "Media dosis cada 12 horas",
        duracionTratamientoDias: 30,
        componentes: [{ drogaId: DROGA_ID, cantidad: "50", unidadMedidaId: UNIDAD_ID, modoExpresion: "POR_DOSIS", esPrincipioActivo: true }],
      },
    ],
    equivalencias: [{ aliasTexto: "Cafeinna", drogaId: DROGA_ID }],
    ...overrides,
  };
}

const PACIENTE_EXISTENTE = {
  id: PACIENTE_ID,
  nombre: "Ana",
  apellido: "Suárez",
  dni: "28999111",
  cuil: CUIL,
  sexo: null,
  fechaNacimiento: null,
  nroCredencial: null,
  fechaBaja: null,
};

describe("recetas.importar -- input schema", () => {
  it("accepts the payload the form builds", () => {
    expect(importarRecetaInput.safeParse(payload()).success).toBe(true);
  });

  it("only stores the emisor's own verification link", () => {
    const r = importarRecetaInput.safeParse(payload({ urlVerificacion: "https://evil.example.com/prescripcion/x" }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["urlVerificacion"]);
    expect(importarRecetaInput.safeParse(payload({ urlVerificacion: "javascript:alert(1)" })).success).toBe(false);
    expect(importarRecetaInput.safeParse(payload({ urlVerificacion: null })).success).toBe(true);
  });

  it("rejects an unknown emisor, a short emisor number and an invalid CIE-10 code", () => {
    expect(importarRecetaInput.safeParse(payload({ emisor: "OTRO" })).success).toBe(false);
    expect(importarRecetaInput.safeParse(payload({ nroRecetaEmisor: "123" })).success).toBe(false);
    expect(importarRecetaInput.safeParse(payload({ diagnosticoCodigo: "obesidad" })).success).toBe(false);
  });
});

describe("recetas.importar -- confirmation", () => {
  it("completes the existing paciente's empty fields, creates the médico, the DIGITAL_PDF receta and the alias -- one audit row each", async () => {
    repo.buscarPacientePorIdentificacion.mockResolvedValue(PACIENTE_EXISTENTE);

    const out = await importarRecetaCommand.execute(payload(), { session: CON_PERMISO });
    expect(out).toEqual({ id: "99999999-9999-4999-a999-999999999999", numeroInterno: "77" });

    // Paciente: only the empty field the PDF brings (never an existing value).
    expect(repo.completarPaciente).toHaveBeenCalledWith(FAKE_TX, TENANT_ID, PACIENTE_ID, { fechaNacimiento: "1981-03-05" });
    expect(insertPacienteMock).not.toHaveBeenCalled();
    // Médico: alta through the médicos module's own handler.
    expect(insertMedicoMock).toHaveBeenCalledWith(FAKE_TX, expect.objectContaining({ matricula: "5120", matriculaJurisdiccion: "PROVINCIAL" }));

    expect(insertRecetaMock).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({
        pacienteId: PACIENTE_ID,
        medicoId: "44444444-4444-4444-a444-444444444444",
        origen: "DIGITAL_PDF",
        registradaPorId: "u-1",
        emisor: "RCTA",
        nroRecetaEmisor: "0200012345678",
        urlVerificacion: "https://verumrp.com.ar/prescripcion/TESTHASH0001",
        fechaValidaDesde: "2026-08-19",
        diagnosticoCodigo: "E66.0",
      }),
    );
    expect(repo.insertDrogaAlias).toHaveBeenCalledWith(FAKE_TX, { tenantId: TENANT_ID, drogaId: DROGA_ID, aliasNormalizado: "cafeinna", creadoPorId: "u-1" });

    const auditadas = auditRecordMock.mock.calls.map(([, row]) => {
      const r = row as { entidad: string; accion: string };
      return `${r.entidad}:${r.accion}`;
    });
    expect(auditadas).toEqual(["paciente:MODIFICAR", "medico:CREAR", "receta:CREAR", "droga_alias:CREAR"]);
  });

  it("a new paciente is created through the pacientes module's own handler", async () => {
    await importarRecetaCommand.execute(payload({ paciente: { existenteId: null, datos: { nombre: "Ana", apellido: "Suárez", cuil: CUIL } } }), { session: CON_PERMISO });
    expect(insertPacienteMock).toHaveBeenCalledWith(FAKE_TX, expect.objectContaining({ nombre: "Ana", apellido: "Suárez", cuil: CUIL }));
    expect(repo.completarPaciente).not.toHaveBeenCalled();
  });

  it("nothing to complete -> no paciente audit row", async () => {
    repo.buscarPacientePorIdentificacion.mockResolvedValue({ ...PACIENTE_EXISTENTE, fechaNacimiento: "1990-01-01" });
    repo.completarPaciente.mockResolvedValue({});
    await importarRecetaCommand.execute(payload({ equivalencias: [] }), { session: CON_PERMISO });
    const entidades = auditRecordMock.mock.calls.map(([, row]) => (row as { entidad: string }).entidad);
    expect(entidades).toEqual(["medico", "receta"]);
  });

  it("if the match no longer is what the preview showed, the user must read the PDF again", async () => {
    repo.buscarPacientePorIdentificacion.mockResolvedValue(null); // preview said: existing PACIENTE_ID
    await expect(importarRecetaCommand.execute(payload(), { session: CON_PERMISO })).rejects.toBeInstanceOf(ConflictError);
    expect(insertRecetaMock).not.toHaveBeenCalled();
  });

  it("a paciente dado de baja blocks the import (it is not reactivated)", async () => {
    repo.buscarPacientePorIdentificacion.mockResolvedValue({ ...PACIENTE_EXISTENTE, fechaBaja: new Date("2026-01-01") });
    await expect(importarRecetaCommand.execute(payload(), { session: CON_PERMISO })).rejects.toBeInstanceOf(DomainError);
    expect(insertRecetaMock).not.toHaveBeenCalled();
  });

  it("P6: re-checks the duplicate at confirmation time", async () => {
    repo.buscarRecetaImportada.mockResolvedValue("42");
    await expect(importarRecetaCommand.execute(payload(), { session: CON_PERMISO })).rejects.toThrow("receta interna Nº 42");
    expect(insertRecetaMock).not.toHaveBeenCalled();
  });

  it("an alias already pointing at the same droga is skipped; at another droga, it is a conflict", async () => {
    repo.buscarPacientePorIdentificacion.mockResolvedValue(PACIENTE_EXISTENTE);
    repo.getDrogaAlias.mockResolvedValue({ id: "a1", drogaId: DROGA_ID });
    await importarRecetaCommand.execute(payload(), { session: CON_PERMISO });
    expect(repo.insertDrogaAlias).not.toHaveBeenCalled();

    repo.getDrogaAlias.mockResolvedValue({ id: "a1", drogaId: OTRA_DROGA_ID });
    await expect(importarRecetaCommand.execute(payload(), { session: CON_PERMISO })).rejects.toBeInstanceOf(ConflictError);
  });

  it("the same V1-V9 validation as the manual alta applies", async () => {
    const [item] = payload().items;
    await expect(importarRecetaCommand.execute(payload({ items: [{ ...item, fraccionDosisPorUnidad: "2" }] }), { session: CON_PERMISO })).rejects.toThrow(
      /fracción de dosis/,
    );
  });
});

// ============================================================================
// P10 -- archive eligibility
// ============================================================================

describe("P10: DIGITAL_PDF recetas are never eligible for an archive lote", () => {
  it("both the eligibility query and its post-lock re-check exclude origen DIGITAL_PDF", async () => {
    const { listRecetasElegibles, recheckRecetasElegibles } = await import("@/modules/archivo/infrastructure/archivo-repository");
    const sql: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        sql.push(strings.join("?"));
        return [];
      }),
    };
    await listRecetasElegibles(tx as never, TENANT_ID, "2026-01-01", "2026-12-31");
    await recheckRecetasElegibles(tx as never, TENANT_ID, ["11111111-1111-4111-a111-111111111111"]);
    expect(sql).toHaveLength(2);
    for (const q of sql) expect(q).toMatch(/origen <> 'DIGITAL_PDF'/);
  });
});
