/**
 * Authorization matrix test for FASE 3 point 3.11 (`modules/auditoria`),
 * per plan §7's row: "Auditoría | auditoria.ver | ADM, DT | Solo lectura;
 * nunca editable". Same pattern as
 * tests/unit/usuarios-authorization-matrix.test.ts (see that file's doc
 * comment for the full reasoning): for each registered use case this
 * asserts
 *   1. its DECLARED `permiso` matches what plan §7 assigns, and
 *   2. role-by-role allow/deny through the REAL `execute()` path
 *      (injected session, NODE_ENV=test), with NO real database.
 *
 * `SEED_GRANTS` is a verbatim, hand-copied source from migration 0002's
 * `rol_permiso` seed (confirmed directly against the SQL for this task:
 * `('ADMINISTRADOR', 'auditoria.ver'), ('DIRECTOR_TECNICO', 'auditoria.ver')`
 * -- no other role is granted `auditoria.ver`).
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
await import("@/modules/auditoria/application/list-registro-auditoria");
await import("@/modules/auditoria/application/list-usuarios-para-filtro");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0002's rol_permiso seed -- the only permiso this module gates on. */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["auditoria.ver"],
  DIRECTOR_TECNICO: ["auditoria.ver"],
  FARMACEUTICO: [],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: [],
};

/** Both registered use cases in this module are gated on `auditoria.ver` -- see each file's doc comment for why the second one isn't itself named `auditoria.ver`. */
const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "auditoria.ver", permiso: "auditoria.ver", input: {} },
  { name: "auditoria.ver.usuarios-filtro", permiso: "auditoria.ver", input: {} },
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

describe("FASE 3 point 3.11 (auditoria) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}" -- plan §7 expects one`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 3 point 3.11 (auditoria) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
          // Getting PAST authorize() is what "allowed" means here -- what
          // happens downstream (stub-tx TypeError, domain/validation
          // error) is irrelevant to authorization itself.
          expect(rejectedWith, `"${name}" unexpectedly denied ${rol}`).not.toBeInstanceOf(AuthorizationError);
        } else {
          expect(rejectedWith, `"${name}" did not deny ${rol}`).toBeInstanceOf(AuthorizationError);
        }
      });
    }
  }
});
