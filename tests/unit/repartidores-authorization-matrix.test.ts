/**
 * Authorization matrix for modules/repartidores (openspec/specs/envios-repartidores/spec.md, "Permisos"):
 *   - the ABM (crear, editar, cambiar estado, listar, ver): `repartidores.gestionar` (categoría `gestion`: ADMINISTRADOR
 *     holds it by category; no predefined role holds it otherwise).
 *   - the autocomplete source: `entregas.registrar` OR `repartidores.gestionar`. `defineQuery` takes ONE permiso, so
 *     it is two registered queries over the same handler; both are exercised here.
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError } from "@/shared/errors";
import type { Permiso } from "@/modules/auth/domain/permisos";
import { PERMISO_CATALOGO } from "@/modules/auth/domain/permisos";

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

await import("@/modules/repartidores/application/crear-repartidor");
await import("@/modules/repartidores/application/editar-repartidor");
await import("@/modules/repartidores/application/cambiar-estado-repartidor");
await import("@/modules/repartidores/application/list-repartidores");
await import("@/modules/repartidores/application/get-repartidor");
await import("@/modules/repartidores/application/buscar-repartidores");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** ADMINISTRADOR: the `gestion` permisos by category (never an operativo one such as entregas.registrar). The others: tests/db/auth-permisos.test.ts. */
const GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["repartidores.gestionar"],
  DIRECTOR_TECNICO: ["entregas.registrar"],
  FARMACEUTICO: ["entregas.registrar"],
  ATENCION_PUBLICO: ["entregas.registrar"],
  SOLO_CONSULTA: [],
};

const TARGET_ID = "22222222-2222-4222-a222-222222222222";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "repartidores.crear", permiso: "repartidores.gestionar", input: { nombre: "Juan", apellido: "Pérez", telefono: "261 555-0101" } },
  { name: "repartidores.editar", permiso: "repartidores.gestionar", input: { id: TARGET_ID, nombre: "Juan", apellido: "Pérez", telefono: "261 555-0101" } },
  { name: "repartidores.cambiarEstado", permiso: "repartidores.gestionar", input: { id: TARGET_ID, activo: false } },
  { name: "repartidores.listar", permiso: "repartidores.gestionar", input: {} },
  { name: "repartidores.ver", permiso: "repartidores.gestionar", input: { id: TARGET_ID } },
  { name: "repartidores.buscar", permiso: "entregas.registrar", input: { texto: "per" } },
  { name: "repartidores.buscarGestion", permiso: "repartidores.gestionar", input: { texto: "per", soloActivos: false } },
];

function sessionFor(rol: Rol): AuthenticatedSession {
  return {
    usuario: { id: `u-${rol}`, email: `${rol}@example.com`, nombre: "N", apellido: "A" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(GRANTS[rol]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

describe("repartidores.gestionar in the permiso catalog", () => {
  it("is a `gestion` permiso: ADMINISTRADOR gets it by category, no predefined role holds it", () => {
    expect(PERMISO_CATALOGO["repartidores.gestionar"]).toBe("gestion");
  });
});

describe("repartidores authorization matrix -- every use case's DECLARED permiso", () => {
  for (const { name, permiso } of CASES) {
    it(`"${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("repartidores authorization matrix -- role x permiso, through the REAL execute() path", () => {
  for (const rol of ROLES) {
    for (const { name, permiso, input } of CASES) {
      const expectedAllowed = GRANTS[rol].includes(permiso);

      it(`${rol} ${expectedAllowed ? "IS" : "is NOT"} allowed to execute "${name}"`, async () => {
        const entry = listRegisteredUseCasesForTests().find((e) => e.name === name)!;

        let rejectedWith: unknown;
        try {
          await entry.execute(input, { session: sessionFor(rol) });
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
