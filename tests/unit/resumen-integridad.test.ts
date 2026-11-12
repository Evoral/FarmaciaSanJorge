/**
 * `resumenIntegridad` / `resumenIntegridadConVerificacion` -- the per-tenant in-memory cache and the raw per-libro
 * result a cache MISS hands to the incident registration (openspec/changes/incidentes-integridad-plataforma, design D2).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }),
}));

const TENANT = "11111111-1111-4111-a111-111111111111";
const SESSION: AuthenticatedSession = {
  usuario: { id: "u1", email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT,
  sesionId: "s1",
  permisos: new Set(["libro.ver"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => SESSION),
  requireRecentReauth: vi.fn(),
}));

const LIBRO_REC = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const LIBRO_PSI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const listLibrosAbiertos = vi.fn();
const verificarCadenaLibro = vi.fn();
vi.mock("@/modules/libro/infrastructure/asiento-repository", () => ({
  listLibrosAbiertos: (...args: unknown[]) => listLibrosAbiertos(...args),
  verificarCadenaLibro: (...args: unknown[]) => verificarCadenaLibro(...args),
}));

const { resumenIntegridad, resumenIntegridadConVerificacion, resumenIntegridadQuery, invalidarResumenIntegridad } = await import(
  "@/modules/libro/application/resumen-integridad"
);

beforeEach(() => {
  invalidarResumenIntegridad();
  listLibrosAbiertos.mockReset();
  verificarCadenaLibro.mockReset();
  listLibrosAbiertos.mockResolvedValue([
    { id: LIBRO_REC, tipo: "RECETARIO" },
    { id: LIBRO_PSI, tipo: "PSICOTROPICO" },
  ]);
  verificarCadenaLibro.mockImplementation(async (_tx: unknown, _tenant: string, libroId: string) => (libroId === LIBRO_REC ? "7" : null));
});

describe("resumenIntegridadConVerificacion", () => {
  it("on a cache miss lists every open libro in verificacion, OK ones with quiebre null", async () => {
    const { quebrados, verificacion } = await resumenIntegridadConVerificacion();

    expect(quebrados).toEqual([{ tipo: "RECETARIO", primerQuiebreNumero: "7" }]);
    expect(verificacion).toEqual([
      { libroId: LIBRO_REC, tipo: "RECETARIO", quiebre: "7" },
      { libroId: LIBRO_PSI, tipo: "PSICOTROPICO", quiebre: null },
    ]);
  });

  it("on a cache hit verificacion is null and quebrados is identical", async () => {
    const primera = await resumenIntegridadConVerificacion();
    const segunda = await resumenIntegridadConVerificacion();

    expect(segunda.verificacion).toBeNull();
    expect(segunda.quebrados).toEqual(primera.quebrados);
    expect(verificarCadenaLibro).toHaveBeenCalledTimes(2); // only the first (miss) walked the two libros
  });

  it("invalidarResumenIntegridad forces a miss again", async () => {
    await resumenIntegridadConVerificacion();
    invalidarResumenIntegridad();
    const { verificacion } = await resumenIntegridadConVerificacion();

    expect(verificacion).not.toBeNull();
    expect(verificarCadenaLibro).toHaveBeenCalledTimes(4);
  });

  it("an empty tenant (no open libro) is a miss with an empty verificacion, not null", async () => {
    listLibrosAbiertos.mockResolvedValue([]);
    const { quebrados, verificacion } = await resumenIntegridadConVerificacion();

    expect(quebrados).toEqual([]);
    expect(verificacion).toEqual([]);
  });
});

describe("resumenIntegridad (banner contract)", () => {
  it("keeps returning the LibroQuebrado[] array", async () => {
    expect(await resumenIntegridad()).toEqual([{ tipo: "RECETARIO", primerQuiebreNumero: "7" }]);
  });

  it("the query stays read-only: it only reads through the verification repository functions", async () => {
    const out = await resumenIntegridadQuery.execute({}, { session: SESSION });
    expect(out.quebrados).toHaveLength(1);
  });
});
