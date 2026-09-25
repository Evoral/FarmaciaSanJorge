/**
 * Authorization matrix test for FASE 13 (M16, reportes y tablero): every
 * NEW registered use case's DECLARED permiso matches migration 0043's seed
 * (or the pre-existing permiso it reuses), exercised through the REAL
 * execute() path against every role. Same shape as
 * tests/unit/stock-authorization-matrix.test.ts / libro-authorization-matrix.test.ts.
 *
 * Explicitly covers the task's authz requirements: ATENCION_PUBLICO and
 * SOLO_CONSULTA denied `stock.valorizado.ver`; ADMINISTRADOR denied
 * `reportes.ver`.
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError } from "@/shared/errors";
import type { Permiso } from "@/modules/auth/domain/permisos";

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

vi.mock("@/modules/stock/infrastructure/valorizado-repository", () => ({
  listValorizado: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 25 })),
  subtotalesValorizado: vi.fn(async () => []),
  iterarValorizadoParaExportar: vi.fn(async function* () {}),
}));

vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  kardexMovimientos: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 500 })),
}));

vi.mock("@/modules/libro/infrastructure/contralor-repository", () => ({
  iterarAsientosContralorParaExportar: vi.fn(async function* () {}),
}));

vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  countRecetasPorEstado: vi.fn(async () => []),
  listRecetasPorEstado: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
}));

await import("@/modules/stock/application/reporte-valorizado");
await import("@/modules/stock/application/reporte-kardex");
await import("@/modules/libro/application/exportar-contralor");
await import("@/modules/recetas/application/reporte-recetas");
await import("@/modules/recetas/application/list-recetas");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0043 (stock.valorizado.ver) + migration 0002 (everything else, reused as-is). */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["stock.valorizado.ver"],
  DIRECTOR_TECNICO: ["stock.valorizado.ver", "stock.ver", "libro.exportar", "reportes.ver", "recetas.crear"],
  FARMACEUTICO: ["stock.valorizado.ver", "stock.ver", "libro.exportar", "reportes.ver", "recetas.crear"],
  ATENCION_PUBLICO: ["stock.ver", "recetas.crear"],
  SOLO_CONSULTA: ["stock.ver", "libro.exportar", "reportes.ver"],
};

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "stock.valorizado.listar", permiso: "stock.valorizado.ver", input: {} },
  { name: "stock.valorizado.exportar.datos", permiso: "stock.valorizado.ver", input: {} },
  { name: "stock.valorizado.exportar.auditar", permiso: "stock.valorizado.ver", input: { formato: "CSV", filtroResumen: "Sin filtros", cantidadFilas: 0, truncated: false } },
  { name: "stock.kardex.exportar.datos", permiso: "stock.ver", input: {} },
  { name: "stock.kardex.exportar.auditar", permiso: "stock.ver", input: { filtroResumen: "Sin filtros", cantidadFilas: 0, truncated: false } },
  { name: "libro.contralor.exportar.datos", permiso: "libro.exportar", input: {} },
  { name: "libro.contralor.exportar.auditar", permiso: "libro.exportar", input: { formato: "CSV", filtroResumen: "Sin filtros", cantidadFilas: 0, truncated: false } },
  { name: "reportes.recetas.porEstado", permiso: "reportes.ver", input: {} },
  { name: "reportes.recetas.listar", permiso: "reportes.ver", input: {} },
  { name: "reportes.recetas.exportar.datos", permiso: "reportes.ver", input: {} },
  { name: "reportes.recetas.exportar.auditar", permiso: "reportes.ver", input: { filtroResumen: "Sin filtros", cantidadFilas: 0, truncated: false } },
  { name: "recetas.resumenPorEstado", permiso: "recetas.crear", input: {} },
];

function sessionForRol(rol: Rol): AuthenticatedSession {
  return {
    usuario: { id: `u-${rol}`, email: `${rol}@example.com`, nombre: "N", apellido: "A" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(SEED_GRANTS[rol]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

describe("FASE 13 (reportes) authorization matrix -- every use case's DECLARED permiso matches migration 0043", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 13 (reportes) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
  for (const rol of ROLES) {
    for (const { name, permiso, input } of CASES) {
      const expectedAllowed = SEED_GRANTS[rol].includes(permiso);

      it(`${rol} ${expectedAllowed ? "IS" : "is NOT"} allowed to execute "${name}"`, async () => {
        const entry = listRegisteredUseCasesForTests().find((e) => e.name === name)!;
        const session = sessionForRol(rol);

        let rejectedWith: unknown;
        try {
          await entry.execute(input, { session });
        } catch (error) {
          rejectedWith = error;
        }

        if (expectedAllowed) {
          expect(rejectedWith, `"${name}" unexpectedly denied ${rol}`).not.toBeInstanceOf(AuthorizationError);
        } else {
          expect(rejectedWith, `"${name}" did not deny ${rol}`).toBeInstanceOf(AuthorizationError);
        }
      });
    }
  }
});

describe("FASE 13 explicit requirement -- ATENCION_PUBLICO and SOLO_CONSULTA denied stock.valorizado.ver", () => {
  for (const rol of ["ATENCION_PUBLICO", "SOLO_CONSULTA"] as const) {
    it(`${rol} is denied stock.valorizado.listar`, async () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === "stock.valorizado.listar")!;
      const rejectedWith = await entry.execute({}, { session: sessionForRol(rol) }).catch((e) => e);
      expect(rejectedWith).toBeInstanceOf(AuthorizationError);
    });
  }
});

describe("FASE 13 explicit requirement -- ADMINISTRADOR denied reportes.ver", () => {
  it("ADMINISTRADOR is denied reportes.recetas.porEstado", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "reportes.recetas.porEstado")!;
    const rejectedWith = await entry.execute({}, { session: sessionForRol("ADMINISTRADOR") }).catch((e) => e);
    expect(rejectedWith).toBeInstanceOf(AuthorizationError);
  });
});
