/**
 * Authorization matrix test for FASE 3 point 3.10a (modules/farmacia/**),
 * per plan §7: "Farmacia/Parámetros" is one row using `config.ver` /
 * `config.editar` for BOTH the tenant-data module and the parametros
 * module. Follows the exact pattern established by
 * tests/unit/usuarios-authorization-matrix.test.ts -- see that file's doc
 * comment for the full rationale (declared-permiso check + role x permiso
 * exercised through the REAL execute() path, with a mocked tx/audit/session
 * so no real database is needed).
 *
 * Unlike usuarios (one permiso per use case name), `config.editar` is
 * shared by TWO different commands across TWO modules (farmacia's
 * editarDatosTenant and parametros' editarParametro) -- so, unlike the
 * usuarios file, cases here are looked up by the use case's own registered
 * `name` (unique per command/query), not by permiso.
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

// Imported AFTER the mocks above (vi.mock is hoisted).
await import("@/modules/farmacia/application/get-datos-tenant");
await import("@/modules/farmacia/application/editar-datos-tenant");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0002's rol_permiso seed. */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["config.ver", "config.editar"],
  DIRECTOR_TECNICO: ["config.ver"],
  FARMACEUTICO: ["config.ver"],
  ATENCION_PUBLICO: ["config.ver"],
  SOLO_CONSULTA: ["config.ver"],
};

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "farmacia.getDatosTenant", permiso: "config.ver", input: {} },
  {
    name: "farmacia.editarDatosTenant",
    permiso: "config.editar",
    input: { razonSocial: "Farmacia Test" },
  },
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

describe("FASE 3.10a (modules/farmacia) authorization matrix -- declared permiso", () => {
  for (const { name, permiso } of CASES) {
    it(`use case "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 3.10a (modules/farmacia) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
  for (const rol of ROLES) {
    for (const { name, permiso, input } of CASES) {
      const expectedAllowed = SEED_GRANTS[rol].includes(permiso);

      it(`${rol} ${expectedAllowed ? "IS" : "is NOT"} allowed to execute "${name}" (${permiso})`, async () => {
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
