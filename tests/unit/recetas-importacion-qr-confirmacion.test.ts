/**
 * importacion-receta-qr P53: confirming an imported receta (`recetas.importar`)
 * never goes back to RCTA; the data the user reviewed is the data that gets saved.
 *   1. Behavior: the REAL command runs with `fuente: "QR"` while the global
 *      `fetch` (the only way the real adapter reaches RCTA) is a spy.
 *   2. Structure: the static import graph of the confirm use case, and the direct
 *      imports of the form, never reach the adapter or the QR reader.
 * Personal data below is fictitious.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AuthenticatedSession } from "@/shared/auth/session";

vi.mock("@/shared/audit", () => ({ record: vi.fn(), TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }) }));
vi.mock("@/shared/db/transaction", () => ({ withTenantTransaction: async (_t: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true }) }));
vi.mock("@/shared/auth/session", () => ({ requireSession: vi.fn(), requireRecentReauth: vi.fn() }));
vi.mock("@/modules/recetas/infrastructure/importacion-repository", () => ({
  buscarRecetaImportada: async () => null,
  buscarPacientePorIdentificacion: async () => null,
  buscarMedicoVigentePorMatricula: async () => null,
}));
vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  clasificarDrogasDeReceta: async () => ({ invalidas: [], principiosActivos: new Set<string>() }),
  unidadesInvalidas: async () => [],
  jornadaActualTenant: async () => "2026-09-29",
  insertRecetaConItems: async () => ({ id: "99999999-9999-4999-a999-999999999999", numeroInterno: "77" }),
  getNombresParaResumen: async () => ({ drogas: new Map(), unidades: new Map() }),
}));
vi.mock("@/modules/pacientes/infrastructure/paciente-repository", () => ({ existeCuil: async () => false, insertPaciente: async () => ({ id: "33333333-3333-4333-a333-333333333333" }) }));
vi.mock("@/modules/medicos/infrastructure/medico-repository", () => ({ existeMatriculaVigente: async () => false, insertMedico: async () => ({ id: "44444444-4444-4444-a444-444444444444" }) }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const { importarRecetaCommand } = await import("@/modules/recetas/application/importar-receta");

const HASH = "a1b2c3d4e5f60718".repeat(4);
const session = (permisos: string[]): AuthenticatedSession => ({
  usuario: { id: "u-1", email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(permisos) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
});
const payloadQr = () => ({
  fuente: "QR",
  emisor: "RCTA",
  nroRecetaEmisor: "1234567890123",
  urlVerificacion: `https://verumrp.com.ar/prescripcion/${HASH}`,
  fechaPrescripcion: "2026-09-10",
  fechaValidaDesde: "2026-09-10",
  paciente: { existenteId: null, datos: { nombre: "Ana", apellido: "Suárez", dni: "28999111" } },
  medico: { existenteId: null, datos: { nombre: "Camila", apellido: "Ferrero", matricula: "4321", matriculaJurisdiccion: "PROVINCIAL" } },
  items: [
    {
      formaFarmaceutica: "COMPRIMIDO",
      cantidadUnidades: 30,
      fraccionDosisPorUnidad: "1",
      posologia: "Una cada 12 horas",
      componentes: [{ drogaId: "55555555-5555-4555-a555-555555555555", cantidad: "50", unidadMedidaId: "77777777-7777-4777-a777-777777777777", modoExpresion: "POR_DOSIS" }],
    },
  ],
  equivalencias: [],
});

beforeEach(() => fetchMock.mockReset());

describe("P53 -- confirming a QR import never refetches RCTA (behavior)", () => {
  it("saves the receta from the confirm payload with zero fetches", async () => {
    const out = await importarRecetaCommand.execute(payloadQr(), { session: session(["recetas.crear"]) });
    expect(out).toEqual({ id: "99999999-9999-4999-a999-999999999999", numeroInterno: "77" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const RAIZ = resolve(__dirname, "../..");
const PROHIBIDOS = ["modules/recetas/infrastructure/receta-rcta-api.server.ts", "modules/recetas/application/leer-receta-qr.ts"];
const relativo = (archivo: string) => archivo.slice(RAIZ.length + 1).replace(/\\/g, "/");

function importsDirectos(archivo: string): string[] {
  const salida: string[] = [];
  for (const m of readFileSync(archivo, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
    const especificador = m[1]!;
    if (!especificador.startsWith("@/") && !especificador.startsWith(".")) continue; // package
    const base = especificador.startsWith("@/") ? join(RAIZ, especificador.slice(2)) : resolve(dirname(archivo), especificador);
    const destino = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((c) => existsSync(c));
    if (destino) salida.push(destino);
  }
  return salida;
}

function alcanzables(entrada: string): string[] {
  const visto = new Set<string>();
  for (const pendientes = [entrada]; pendientes.length > 0; ) {
    const actual = pendientes.pop()!;
    if (visto.has(actual)) continue;
    visto.add(actual);
    pendientes.push(...importsDirectos(actual));
  }
  return [...visto].map(relativo);
}

describe("P53 -- confirming a QR import never refetches RCTA (import graph)", () => {
  it("the walker sees real edges: the QR reader reaches the adapter, the confirm use case its repository", () => {
    expect(alcanzables(join(RAIZ, "modules/recetas/application/leer-receta-qr.ts"))).toContain("modules/recetas/infrastructure/receta-rcta-api.server.ts");
    expect(alcanzables(join(RAIZ, "modules/recetas/application/importar-receta.ts"))).toContain("modules/recetas/infrastructure/receta-repository.ts");
  });

  it("importar-receta.ts does not (transitively) import the RCTA adapter or the QR reader", () => {
    const alcanzado = alcanzables(join(RAIZ, "modules/recetas/application/importar-receta.ts"));
    for (const prohibido of PROHIBIDOS) expect(alcanzado).not.toContain(prohibido);
  });

  it("receta-form.tsx does not import the RCTA adapter or the QR reader directly", () => {
    const directos = importsDirectos(join(RAIZ, "modules/recetas/ui/receta-form.tsx")).map(relativo);
    expect(directos.length).toBeGreaterThan(0);
    for (const prohibido of PROHIBIDOS) expect(directos).not.toContain(prohibido);
  });
});
