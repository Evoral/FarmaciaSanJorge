/**
 * Authorization matrix + use-case behavior of `proveedores.comparar-costos`
 * (docs/specs/comparador-costos.md). One permiso, `stock.valorizado.ver`
 * (migration 0043: ADMINISTRADOR / DIRECTOR_TECNICO / FARMACEUTICO); the link
 * to the partida detail follows `stock.ver` through `can()` (no extra
 * defineQuery, so a session without it never writes an ACCESO_DENEGADO row).
 * The repository is mocked: this file proves the pipeline wiring and the
 * shape of the result, not SQL (see comparador-costos-repository.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError, ValidationError } from "@/shared/errors";
import type { Permiso } from "@/modules/auth/domain/permisos";
import type { ComparacionCruda } from "@/modules/proveedores/domain/comparador-costos";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
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

const DROGA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MG = { id: "u-mg", codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factorABase: "0.001", esBase: false, vigente: true };
const G = { id: "u-g", codigo: "GRAMO", simbolo: "g", tipoMagnitud: "MASA", factorABase: "1", esBase: true, vigente: true };

const cruda: ComparacionCruda = {
  droga: { id: DROGA_ID, nombre: "Minoxidil", deBaja: false },
  unidadBase: MG,
  unidadesCatalogo: [MG, G],
  periodo: "12m",
  jornada: "2026-10-01",
  zonaHoraria: "America/Argentina/Mendoza",
  inicio: new Date("2025-10-01T03:00:00Z"),
  limites: null,
  partidasConCosto: 1,
  agregados: [
    {
      proveedorId: "pa",
      razonSocial: "Droguería A",
      fechaBaja: null,
      partidasTotal: 1,
      partidasConCosto: 1,
      partidasCostoCero: 0,
      partidasAtipicas: 0,
      cantidadConCosto: "1000",
      importeConCosto: "10",
      costoMin: "0.01",
      costoMax: "0.01",
      ultimoCosto: "0.01",
      ultimaCompra: new Date("2026-09-15T12:00:00Z"),
    },
  ],
  partidas: [],
};

const repo = {
  readDrogasConPartidas: vi.fn(async () => [
    { id: "x", nombre: "Zinc", fechaBaja: new Date("2026-01-01T00:00:00Z") },
    { id: DROGA_ID, nombre: "Minoxidil", fechaBaja: null },
  ]),
  getComparacionCruda: vi.fn(async (): Promise<ComparacionCruda | null> => cruda),
};
vi.mock("@/modules/proveedores/infrastructure/comparador-costos-repository", () => ({
  readDrogasConPartidas: (...args: unknown[]) => (repo.readDrogasConPartidas as (...a: unknown[]) => unknown)(...args),
  getComparacionCruda: (...args: unknown[]) => (repo.getComparacionCruda as (...a: unknown[]) => unknown)(...args),
}));

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");
const { compararCostosDrogaQuery } = await import("@/modules/proveedores/application/comparar-costos-droga");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0043 (stock.valorizado.ver) + migration 0002 (stock.ver for every role except the ADM, who only got the former here). */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["stock.valorizado.ver"],
  DIRECTOR_TECNICO: ["stock.valorizado.ver", "stock.ver"],
  FARMACEUTICO: ["stock.valorizado.ver", "stock.ver"],
  ATENCION_PUBLICO: ["stock.ver"],
  SOLO_CONSULTA: ["stock.ver"],
};

const NAME = "proveedores.comparar-costos";

function session(permisos: readonly Permiso[]): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

describe("proveedores.comparar-costos authorization", () => {
  it(`the use case registered as "${NAME}" declares permiso "stock.valorizado.ver"`, () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === NAME);
    expect(entry, `no registered use case named "${NAME}"`).toBeDefined();
    expect(entry!.permiso).toBe("stock.valorizado.ver");
  });

  for (const rol of ROLES) {
    const permitido = SEED_GRANTS[rol].includes("stock.valorizado.ver");
    it(`${rol} ${permitido ? "IS" : "is NOT"} allowed to execute "${NAME}" (real execute() path)`, async () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === NAME)!;
      let rejectedWith: unknown;
      try {
        await entry.execute({}, { session: session(SEED_GRANTS[rol]) });
      } catch (error) {
        rejectedWith = error;
      }
      if (permitido) expect(rejectedWith).toBeUndefined();
      else expect(rejectedWith).toBeInstanceOf(AuthorizationError);
    });
  }

  it("a denied session never reaches the repository", async () => {
    repo.readDrogasConPartidas.mockClear();
    await expect(compararCostosDrogaQuery.execute({}, { session: session(["stock.ver"]) })).rejects.toBeInstanceOf(AuthorizationError);
    expect(repo.readDrogasConPartidas).not.toHaveBeenCalled();
  });
});

describe("proveedores.comparar-costos behavior", () => {
  const dt = session(SEED_GRANTS.DIRECTOR_TECNICO);

  it("always returns the droga options (vigentes first, then the ones de baja), and no comparison without a droga", async () => {
    repo.getComparacionCruda.mockClear();
    const r = await compararCostosDrogaQuery.execute({}, { session: dt });
    expect(r.drogas.map((d) => [d.nombre, d.deBaja])).toEqual([
      ["Minoxidil", false],
      ["Zinc", true],
    ]);
    expect(r).toMatchObject({ comparacion: null, drogaNoDisponible: false, periodo: "12m" });
    expect(repo.getComparacionCruda).not.toHaveBeenCalled();
  });

  it("returns the comparison for a valid droga, converted to the requested unit, scoped to the session's tenant", async () => {
    repo.readDrogasConPartidas.mockClear();
    repo.getComparacionCruda.mockClear();
    const r = await compararCostosDrogaQuery.execute({ drogaId: DROGA_ID, unidad: "base", periodo: "todo" }, { session: dt });
    expect(repo.readDrogasConPartidas).toHaveBeenCalledWith(expect.anything(), dt.tenantId);
    expect(repo.getComparacionCruda).toHaveBeenCalledWith(expect.anything(), dt.tenantId, DROGA_ID, "todo");
    expect(r.drogaNoDisponible).toBe(false);
    expect(r.comparacion).toMatchObject({ unidadSeleccionada: "base", convertida: false });
    expect(r.comparacion!.proveedores[0]).toMatchObject({ razonSocial: "Droguería A", ultimoCosto: "0.01" });
    // default unit without `unidad`: g
    const porDefecto = await compararCostosDrogaQuery.execute({ drogaId: DROGA_ID }, { session: dt });
    expect(porDefecto.comparacion!.proveedores[0]).toMatchObject({ ultimoCosto: "10" });
    expect(porDefecto.periodo).toBe("12m");
  });

  it("flags a droga that is not the tenant's (or has no partidas) instead of failing", async () => {
    repo.getComparacionCruda.mockResolvedValueOnce(null);
    const r = await compararCostosDrogaQuery.execute({ drogaId: DROGA_ID }, { session: dt });
    expect(r).toMatchObject({ comparacion: null, drogaNoDisponible: true });
    expect(r.drogas).toHaveLength(2);
  });

  it("rejects malformed input with a ValidationError before touching the repository", async () => {
    repo.getComparacionCruda.mockClear();
    for (const input of [{ drogaId: "no-es-uuid" }, { periodo: "24m" }, { unidad: "g r" }, { unidad: "A".repeat(40) }]) {
      await expect(compararCostosDrogaQuery.execute(input, { session: dt }), JSON.stringify(input)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(repo.getComparacionCruda).not.toHaveBeenCalled();
  });

  it("linkPartida follows `stock.ver` through can(): ADM (valorizado only) has no link, DT/FAR do", async () => {
    const adm = await compararCostosDrogaQuery.execute({}, { session: session(SEED_GRANTS.ADMINISTRADOR) });
    expect(adm.linkPartida).toBe(false);
    for (const rol of ["DIRECTOR_TECNICO", "FARMACEUTICO"] as const) {
      expect((await compararCostosDrogaQuery.execute({}, { session: session(SEED_GRANTS[rol]) })).linkPartida, rol).toBe(true);
    }
  });

  it("a session without stock.ver does not write an ACCESO_DENEGADO row for the link (no nested defineQuery)", async () => {
    auditRecordMock.mockClear();
    await compararCostosDrogaQuery.execute({ drogaId: DROGA_ID }, { session: session(["stock.valorizado.ver"]) });
    expect(auditRecordMock).not.toHaveBeenCalled();
  });
});
