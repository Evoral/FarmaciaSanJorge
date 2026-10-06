/**
 * Receta QR import through the REAL use-case pipeline and the REAL HTTP
 * adapter, with only the global `fetch`, the repositories and the transaction
 * mocked (no DB, no network). Covers importacion-receta-qr R4: the order
 * session -> permiso -> hash extraction -> fetch -> match (P46, P47), the fetch
 * running OUTSIDE any transaction (P51), the duplicate check (P48), the QR
 * preview (P49, P50) and that the fetch target is never taken from the typed
 * text. The hash and the receta below are fictitious.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AppError, AuthorizationError, DomainError, ValidationError } from "@/shared/errors";
import { mensajeRecetaYaImportada } from "@/modules/recetas/domain/importacion-receta";
import { MENSAJES_LECTURA_QR } from "@/modules/recetas/domain/receta-qr";

const llamadas: string[] = [];
let txAbierta = false;
let txAbiertas = 0;

vi.mock("@/shared/audit", () => ({ record: vi.fn(), TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }) }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => {
    txAbierta = true;
    txAbiertas += 1;
    llamadas.push("tx-abierta");
    try {
      return await fn({ __fakeTx: true });
    } finally {
      txAbierta = false;
    }
  },
}));
vi.mock("@/shared/auth/session", () => ({ requireSession: vi.fn(), requireRecentReauth: vi.fn() }));
vi.mock("@/modules/recetas/infrastructure/receta-pdf.server", () => ({ extraerTextoRecetaPdf: vi.fn() }));

const repo = {
  buscarRecetaImportada: vi.fn(),
  buscarPacientePorIdentificacion: vi.fn(),
  buscarMedicoVigentePorMatricula: vi.fn(),
  listAliasesVigentes: vi.fn(),
  listDrogasVigentesParaMatch: vi.fn(),
  listUnidadesVigentesParaMatch: vi.fn(),
};
vi.mock("@/modules/recetas/infrastructure/importacion-repository", () => ({
  buscarRecetaImportada: (...a: unknown[]) => repo.buscarRecetaImportada(...a),
  buscarPacientePorIdentificacion: (...a: unknown[]) => repo.buscarPacientePorIdentificacion(...a),
  buscarMedicoVigentePorMatricula: (...a: unknown[]) => repo.buscarMedicoVigentePorMatricula(...a),
  listAliasesVigentes: (...a: unknown[]) => repo.listAliasesVigentes(...a),
  listDrogasVigentesParaMatch: (...a: unknown[]) => repo.listDrogasVigentesParaMatch(...a),
  listUnidadesVigentesParaMatch: (...a: unknown[]) => repo.listUnidadesVigentesParaMatch(...a),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { leerRecetaQrQuery } = await import("@/modules/recetas/application/leer-receta-qr");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
// RCTA's decrypter is case-sensitive: the hash is fetched in the UPPERCASE form its QR link prints.
const HASH = "A1B2C3D4E5F60718".repeat(4);
const URL_ESPERADA = `https://decrypter.verumrp.com.ar/api/RecipeDecryption/WithPrescription?hashedRecipe=${HASH}`;
const DROGA_ID = "55555555-5555-4555-a555-555555555555";
const UNIDAD_ID = "77777777-7777-4777-a777-777777777777";

const session = (permisos: string[]): AuthenticatedSession => ({
  usuario: { id: "u-1", email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(permisos) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
});
const CON_PERMISO = session(["recetas.crear"]);
const leer = (codigo: unknown, s = CON_PERMISO) => leerRecetaQrQuery.execute({ codigo }, { session: s });

const RECETA_JSON = {
  emisor: "RCTA",
  numeroReceta: "1234567890123",
  fechaConfeccion: "03/02/2026",
  fechaEmision: "04/02/2026",
  codDiagnostico: "E660",
  diagnostico: "Obesidad",
  paciente: { nombre: "XXXXX", tipoDoc: "DNI", nroDoc: "11222333", cuil: "20112223334", sexo: "F", fechaNacimiento: "1990-05-20T00:00:00" },
  medico: { nombre: "Camila", apellido: "Ferrero", matricula: { tipo: "MP", numero: "4321" } },
  prescripcion: [{ prescripcion: "Cafeína 50 mg\n30 comprimidos" }],
};
const respuestaJson = (valor: unknown, status = 200) => new Response(JSON.stringify(valor), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  llamadas.length = 0;
  txAbierta = false;
  txAbiertas = 0;
  fetchMock.mockReset().mockImplementation(async () => {
    llamadas.push(txAbierta ? "fetch-con-tx-abierta" : "fetch");
    return respuestaJson(RECETA_JSON);
  });
  for (const fn of Object.values(repo)) fn.mockReset();
  repo.buscarRecetaImportada.mockImplementation(async () => {
    llamadas.push("buscarRecetaImportada");
    return null;
  });
  repo.buscarPacientePorIdentificacion.mockResolvedValue(null);
  repo.buscarMedicoVigentePorMatricula.mockResolvedValue(null);
  repo.listAliasesVigentes.mockResolvedValue([]);
  repo.listDrogasVigentesParaMatch.mockResolvedValue([{ id: DROGA_ID, nombre: "Cafeína" }]);
  repo.listUnidadesVigentesParaMatch.mockResolvedValue([{ id: UNIDAD_ID, codigo: "MILIGRAMO", simbolo: "mg" }]);
});

describe("recetas.importar.leerQr -- order (P46, P47)", () => {
  it("P46: without recetas.crear nothing is fetched or matched (the only transaction is the denial audit)", async () => {
    await expect(leer(HASH, session([]))).rejects.toBeInstanceOf(AuthorizationError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repo.buscarRecetaImportada).not.toHaveBeenCalled();
    expect(llamadas).toEqual(["tx-abierta"]);
  });

  it("P47: a code with no valid hash is rejected with the not-found message before any fetch or transaction", async () => {
    const invalidos = ["", "   ", "garbage", HASH.slice(1), `${HASH}a`, `${HASH} ${"b".repeat(64)}`];
    for (const codigo of invalidos) {
      const error = await leer(codigo).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe(MENSAJES_LECTURA_QR.QR_INVALIDO);
      expect((error as ValidationError).fields).toEqual(["codigo"]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(txAbiertas).toBe(0);
  });

  it("P47: a missing, non-string or over-long code is a validation error before any fetch", async () => {
    for (const codigo of [undefined, 42, `${HASH}${"x".repeat(2048)}`]) {
      await expect(leer(codigo)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("recetas.importar.leerQr -- the fetch target is never taken from the typed text", () => {
  it("fetches EXACTLY the constant endpoint + the extracted hash, whatever surrounds the hash", async () => {
    const entradas = [HASH, ` ${HASH.toLowerCase()}\n`, `https://verumrp.com.ar/prescripcion/${HASH}`, `evil.com/${HASH}`, `https;--verumrp.com.ar-prescripcion-${HASH}`, `evil.example/x?u=${HASH}`];
    for (const entrada of entradas) {
      fetchMock.mockClear();
      await leer(entrada);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe(URL_ESPERADA);
    }
  });

  it("regression (RCTA hash is case-sensitive): a real uppercase link is fetched with the UPPERCASE hash and previews the uppercase verification URL", async () => {
    const vista = await leer(`https://verumrp.com.ar/prescripcion/${HASH}`);
    expect(fetchMock.mock.calls[0]![0]).toBe(URL_ESPERADA);
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain(HASH.toLowerCase());
    expect(vista.borrador.urlVerificacion).toBe(`https://verumrp.com.ar/prescripcion/${HASH}`);
  });

  it("a link on a foreign host never reaches the network, even with the emisor's host in the userinfo", async () => {
    for (const entrada of [`https://verumrp.com.ar@evil.com/prescripcion/${HASH}`, `https://evil.com/${HASH}`, `https://verumrp.com.ar.evil.com/${HASH}`]) {
      await expect(leer(entrada)).rejects.toMatchObject({ message: MENSAJES_LECTURA_QR.QR_INVALIDO });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("recetas.importar.leerQr -- fetch outside the transaction (P51)", () => {
  it("calls fetch first, then opens the transaction and only then matches", async () => {
    await leer(HASH);
    expect(llamadas).toEqual(["fetch", "tx-abierta", "buscarRecetaImportada"]);
  });

  it("a failed fetch never opens a transaction", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(leer(HASH)).rejects.toBeInstanceOf(DomainError);
    expect(txAbiertas).toBe(0);
  });
});

describe("recetas.importar.leerQr -- preview and duplicate (P48-P50)", () => {
  it("P49-P50: a valid receta of an unknown paciente gives the QR preview with no patient name", async () => {
    const vista = await leer(HASH);
    expect(vista.fuente).toBe("QR");
    expect(vista.borrador).toMatchObject({ emisor: "RCTA", nroRecetaEmisor: "1234567890123", urlVerificacion: `https://verumrp.com.ar/prescripcion/${HASH}` });
    expect(vista.borrador.paciente.nombre).toBeNull();
    expect(vista.paciente.existente).toBeNull();
    expect(vista.advertencias.map((a) => a.codigo)).toContain("DATO_FALTANTE");
    expect(vista.componentes[0]).toEqual([{ drogaId: DROGA_ID, drogaNombre: "Cafeína", via: "NOMBRE", unidadMedidaId: UNIDAD_ID }]);
    expect(repo.buscarRecetaImportada).toHaveBeenCalledWith(expect.anything(), TENANT_ID, "RCTA", "1234567890123");
  });

  it("P49: an existing paciente (by CUIL) is matched, and the name-less draft produces no name difference", async () => {
    repo.buscarPacientePorIdentificacion.mockResolvedValue({ id: "22222222-2222-4222-a222-222222222222", nombre: "Ana", apellido: "Suárez", dni: null, cuil: null, sexo: null, fechaNacimiento: null, nroCredencial: null, fechaBaja: null });
    const vista = await leer(HASH);
    expect(vista.paciente.existente).toMatchObject({ nombre: "Ana", apellido: "Suárez" });
    expect(vista.paciente.completar).toContain("dni");
    expect(vista.paciente.diferencias.map((d) => d.campo)).not.toContain("nombre");
  });

  it("P48: an already imported receta fails with the existing 'ya fue cargada' error", async () => {
    repo.buscarRecetaImportada.mockResolvedValue("77");
    const error = await leer(HASH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe(mensajeRecetaYaImportada("77"));
  });
});

describe("recetas.importar.leerQr -- the final preview's notices are bounded", () => {
  const puntos = (s: string) => Array.from(s).length;
  const componentes = (n: number) => Array.from({ length: n }, (_, i) => `${"Z".repeat(300)}${i} 50 mg`).join("\n");

  it("many unmatched drugs with a huge name give at most 50 notices of at most 200 characters (+ ellipsis), the last one being the overflow notice", async () => {
    fetchMock.mockImplementation(async () => respuestaJson({ ...RECETA_JSON, prescripcion: [{ prescripcion: `${componentes(70)}\n30 comprimidos` }] }));
    repo.listDrogasVigentesParaMatch.mockResolvedValue([]);
    const vista = await leer(HASH);
    expect(vista.componentes[0]!.length).toBeGreaterThan(60);
    expect(vista.advertencias).toHaveLength(50);
    expect(vista.advertencias[49]).toEqual({ codigo: "AVISOS_OMITIDOS", mensaje: "Hay más avisos que no se muestran." });
    const sinMatch = vista.advertencias.filter((a) => a.codigo === "DROGA_SIN_MATCH");
    expect(sinMatch.length).toBeGreaterThan(40);
    expect(sinMatch.length).toBeLessThan(50);
    for (const a of vista.advertencias) {
      expect(puntos(a.mensaje)).toBeLessThanOrEqual(600);
      expect(puntos(a.texto ?? "")).toBeLessThanOrEqual(201);
    }
    expect(sinMatch[0]!.texto).toBe(`${"Z".repeat(200)}…`);
    // The message keeps its structure: only the echoed drug name is cut, the closing mark and the advice stay.
    expect(sinMatch[0]!.mensaje).toBe(`No se encontró la droga «${"Z".repeat(200)}…» en el catálogo.`);
  });

  it("a flood of unrecognized lines does not push out the 'paciente dado de baja' notice", async () => {
    const lineas = Array.from({ length: 60 }, (_, i) => `Renglon libre ${i} sin dosis`).join("\n");
    fetchMock.mockImplementation(async () => respuestaJson({ ...RECETA_JSON, prescripcion: [{ prescripcion: `Amoxicilina 500 mg\n30 comprimidos\n${lineas}` }] }));
    repo.buscarPacientePorIdentificacion.mockResolvedValue({ id: "22222222-2222-4222-a222-222222222222", nombre: "Ana", apellido: "Suárez", dni: null, cuil: null, sexo: null, fechaNacimiento: null, nroCredencial: null, fechaBaja: new Date("2025-01-01") });
    const vista = await leer(HASH);
    expect(vista.advertencias).toHaveLength(50);
    expect(vista.advertencias[49]!.codigo).toBe("AVISOS_OMITIDOS");
    expect(vista.advertencias.filter((a) => a.codigo === "RENGLON_NO_RECONOCIDO").length).toBeGreaterThan(40);
    expect(vista.advertencias.filter((a) => a.codigo === "PACIENTE_DADO_DE_BAJA")).toHaveLength(1);
  });

  it("a normal receta is untouched by the bound (no overflow notice, no truncation)", async () => {
    const vista = await leer(HASH);
    expect(vista.advertencias.some((a) => a.codigo === "AVISOS_OMITIDOS")).toBe(false);
    expect(vista.advertencias.length).toBeLessThan(50);
  });
});

describe("recetas.importar.leerQr -- RCTA failures become user errors, never INTERNAL_ERROR", () => {
  const casos: Array<[string, () => Promise<Response> | Response, string, typeof ValidationError | typeof DomainError]> = [
    ["unknown hash (500 + 'Recipe does not exists')", () => respuestaJson({ error: "Recipe does not exists" }, 500), MENSAJES_LECTURA_QR.QR_INVALIDO, ValidationError],
    ["400", () => new Response("", { status: 400 }), MENSAJES_LECTURA_QR.QR_INVALIDO, ValidationError],
    ["404 (the endpoint moved: an outage, not 'invalid QR')", () => new Response("", { status: 404 }), MENSAJES_LECTURA_QR.RCTA_NO_DISPONIBLE, DomainError],
    ["200 {} (nothing found)", () => respuestaJson({}), MENSAJES_LECTURA_QR.QR_INVALIDO, ValidationError],
    ["503", () => respuestaJson({ error: "down" }, 503), MENSAJES_LECTURA_QR.RCTA_NO_DISPONIBLE, DomainError],
    ["429", () => new Response("", { status: 429 }), MENSAJES_LECTURA_QR.RCTA_NO_DISPONIBLE, DomainError],
    ["network error", () => Promise.reject(new TypeError(`fetch failed ${HASH}`)), MENSAJES_LECTURA_QR.RCTA_NO_DISPONIBLE, DomainError],
    ["non-JSON body", () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), MENSAJES_LECTURA_QR.FORMATO_INESPERADO, DomainError],
    ["JSON failing the schema", () => respuestaJson({ ...RECETA_JSON, emisor: "OTRO" }), MENSAJES_LECTURA_QR.FORMATO_INESPERADO, DomainError],
  ];

  it.each(casos)("%s", async (_nombre, respuesta, mensaje, clase) => {
    fetchMock.mockImplementation(async () => respuesta());
    const error = await leer(HASH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(clase);
    expect((error as AppError).message).toBe(mensaje);
    expect((error as AppError).code).not.toBe("INTERNAL_ERROR");
    expect((error as AppError).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(HASH);
    expect(txAbiertas).toBe(0);
  });
});
