/**
 * `drogas.historial` (modules/drogas/application/get-historial-droga.ts):
 * declared permiso, gating of the optional pieces through can() (no extra
 * defineQuery), and input validation. The repository is mocked: this proves the
 * use case's wiring and the permission rules, not the SQL (that is
 * tests/unit/drogas-historial-repository.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError, ValidationError } from "@/shared/errors";
import type { Permiso } from "@/modules/auth/domain/permisos";
import type { HistorialDrogaCruda } from "@/modules/drogas/domain/historial";

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

const getHistorialDrogaCruda = vi.fn();
vi.mock("@/modules/drogas/infrastructure/historial-repository", () => ({
  getHistorialDrogaCruda: (...args: unknown[]) => getHistorialDrogaCruda(...args),
}));

const { getHistorialDrogaQuery, accesoHistorialDroga, puedeVerHistorialDroga } = await import("@/modules/drogas/application/get-historial-droga");
const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const TENANT = "11111111-1111-1111-1111-111111111111";
const DROGA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARTIDA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sessionWith(permisos: Permiso[]): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "a@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT,
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const cruda = (): HistorialDrogaCruda => ({
  droga: { id: DROGA, nombre: "Minoxidil", fechaBaja: null, unidadBaseId: "u-g", unidadBaseSimbolo: "g" },
  zonaHoraria: "America/Argentina/Mendoza",
  partidasDisponibles: [],
  partidaIds: [],
  totalRecetas: 1,
  totalFiltradas: 1,
  page: 1,
  recetas: [{ id: "r1", numeroInterno: "120", estado: "PREPARADA", preparadaEn: new Date("2026-10-01T15:00:00Z"), consumido: "5", medicoApellido: "Gómez", medicoNombre: "Ana" }],
  pacientes: [{ recetaId: "r1", apellido: "Pérez", nombre: "Juan" }],
  partidasConsumidas: [],
});

beforeEach(() => {
  getHistorialDrogaCruda.mockReset();
  getHistorialDrogaCruda.mockImplementation(async () => cruda());
});

describe("drogas.historial -- declared permiso and gate", () => {
  it('is registered as "drogas.historial" on permiso "recetas.crear" (the receta-read permiso, same as recetas.ver / recetas.listar)', () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "drogas.historial");
    expect(entry, 'no registered use case named "drogas.historial"').toBeDefined();
    expect(entry!.permiso).toBe("recetas.crear");
    expect(entry!.kind).toBe("query");
  });

  it("denies a session without recetas.crear even if it holds every other permiso involved, and never reads", async () => {
    const session = sessionWith(["drogas.editar", "pacientes.gestionar", "stock.ver"]);
    await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session })).rejects.toBeInstanceOf(AuthorizationError);
    expect(getHistorialDrogaCruda).not.toHaveBeenCalled();
  });

  it("allows recetas.crear and passes (tx, tenant, droga, page, page size, acceso, filter) to the repository", async () => {
    const session = sessionWith(["recetas.crear"]);
    await getHistorialDrogaQuery.execute({ drogaId: DROGA, page: 3, partidaIds: [PARTIDA] }, { session });
    expect(getHistorialDrogaCruda).toHaveBeenCalledTimes(1);
    expect(getHistorialDrogaCruda).toHaveBeenCalledWith({ __fakeTx: true, tenantId: TENANT }, TENANT, DROGA, 3, 20, { pacientes: false, stock: false }, [PARTIDA]);
  });

  it("defaults page to 1 and the filter to empty", async () => {
    await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear"]) });
    expect(getHistorialDrogaCruda).toHaveBeenCalledWith(expect.anything(), TENANT, DROGA, 1, 20, expect.anything(), []);
  });
});

describe("drogas.historial -- optional pieces follow the session's OTHER permisos (can(), no extra defineQuery)", () => {
  it("a session with only recetas.crear sees no paciente and no stock link", () => {
    expect(accesoHistorialDroga(sessionWith(["recetas.crear"]))).toEqual({ pacientes: false, stock: false });
  });

  it("each flag is exactly the permiso of its piece", () => {
    const cases: ReadonlyArray<[Permiso, keyof ReturnType<typeof accesoHistorialDroga>]> = [
      ["pacientes.gestionar", "pacientes"],
      ["stock.ver", "stock"],
    ];
    for (const [permiso, flag] of cases) {
      const acceso = accesoHistorialDroga(sessionWith(["recetas.crear", permiso]));
      for (const [, other] of cases) expect(acceso[other], `${permiso} -> ${String(other)}`).toBe(other === flag);
    }
  });

  it("asks the repository for the paciente names only with pacientes.gestionar", async () => {
    await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear", "pacientes.gestionar"]) });
    expect(getHistorialDrogaCruda).toHaveBeenLastCalledWith(expect.anything(), TENANT, DROGA, 1, 20, { pacientes: true, stock: false }, []);
  });

  it("never exposes a paciente without pacientes.gestionar, even if the repository handed rows in", async () => {
    const out = await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear"]) });
    expect(out!.recetas[0]!.paciente).toBeNull();
    expect(JSON.stringify(out)).not.toContain("Pérez");
  });

  it("shows the paciente name with pacientes.gestionar", async () => {
    const out = await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear", "pacientes.gestionar", "stock.ver"]) });
    expect(out!.recetas[0]!.paciente).toBe("Pérez, Juan");
    expect(out!.acceso).toEqual({ pacientes: true, stock: true });
  });

  it("returns null when the droga does not exist in the tenant (the page answers 404)", async () => {
    getHistorialDrogaCruda.mockResolvedValueOnce(null);
    expect(await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear"]) })).toBeNull();
  });
});

describe("puedeVerHistorialDroga -- the single rule for the tab and the page", () => {
  it("is true only with recetas.crear", () => {
    expect(puedeVerHistorialDroga(sessionWith(["recetas.crear"]))).toBe(true);
    expect(puedeVerHistorialDroga(sessionWith(["drogas.editar", "pacientes.gestionar", "stock.ver"]))).toBe(false);
  });
});

describe("drogas.historial -- input validation", () => {
  const session = () => sessionWith(["recetas.crear"]);

  it("rejects a malformed droga id", async () => {
    await expect(getHistorialDrogaQuery.execute({ drogaId: "no-uuid" }, { session: session() })).rejects.toBeInstanceOf(ValidationError);
    expect(getHistorialDrogaCruda).not.toHaveBeenCalled();
  });

  it("rejects page 0, a fractional page and a page above the cap", async () => {
    for (const page of [0, 1.5, 100_001]) {
      await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA, page }, { session: session() })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("rejects a filter with a non-uuid id or more than 20 ids", async () => {
    await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA, partidaIds: ["x"] }, { session: session() })).rejects.toBeInstanceOf(ValidationError);
    const veintiuno = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA, partidaIds: veintiuno }, { session: session() })).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts exactly 20 filter ids", async () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA, partidaIds: veinte }, { session: session() })).resolves.not.toBeNull();
  });
});
