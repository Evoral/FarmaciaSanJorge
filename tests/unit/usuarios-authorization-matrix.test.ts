/**
 * Authorization matrix test for FASE 3 (points 3.1-3.8), per plan §7.
 *
 * N2 (security review) rewrite: the PREVIOUS version of this file only
 * checked `can(session, permiso)` against a hand-copied grants table --
 * it never read each use case's OWN declared `permiso`, so a command
 * accidentally declared with the WRONG permiso (e.g. `usuarios.editar`
 * instead of `usuarios.roles.modificar`) would still pass every assertion
 * in that file, because the test was checking `can()` in isolation, not
 * what the command itself requires.
 *
 * This version imports every REAL usuarios command/query, and for each
 * one:
 *   1. asserts its DECLARED `permiso` (`entry.permiso`, read off the
 *      actual `defineCommand`/`defineQuery` config) equals the permiso
 *      plan §7's matrix assigns to that action -- catches a
 *      wrong-permiso-in-the-declaration bug directly;
 *   2. asserts role-by-role allow/deny through the REAL `execute()` path
 *      (injected session, NODE_ENV=test -- see shared/usecase.ts's
 *      `resolveSession`) -- catches a bug where the declaration is right
 *      but something downstream (a stray manual permission check, a typo
 *      in `authorize()`'s call site) diverges from it. `execute()` is run
 *      with NO real database: `@/shared/db/transaction` is mocked (same
 *      as tests/unit/usecase.test.ts) so a call that gets PAST
 *      `authorize()` either resolves or throws something OTHER than
 *      `AuthorizationError` (typically a `TypeError` from the stub
 *      transaction object, or a domain/validation error) -- what matters
 *      for THIS test is only whether `authorize()` itself let the call
 *      through, not what happens after.
 *
 * `SEED_GRANTS` below is still the same verbatim, hand-copied source from
 * migration 0002's `rol_permiso` seed as before (a second, independent
 * source so a future change to either one shows up as a test diff instead
 * of silent drift) -- tests/db/usuarios-roles.test.ts covers the DB side
 * of that seed directly.
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
  // Not what this file is testing (that's tests/unit/usuarios-usecase-registry.test.ts's
  // M2 case) -- every session here has a fresh reautenticadaEn anyway, so a
  // no-op vs. the real policy would not change any assertion below.
  requireRecentReauth: vi.fn(),
}));

// Imported AFTER the mocks above (vi.mock is hoisted).
await import("@/modules/usuarios/application/list-usuarios");
await import("@/modules/usuarios/application/get-usuario");
await import("@/modules/usuarios/application/list-usuario-auditoria");
await import("@/modules/usuarios/application/crear-usuario");
await import("@/modules/usuarios/application/editar-usuario");
await import("@/modules/usuarios/application/cambiar-roles");
await import("@/modules/usuarios/application/suspender-usuario");
await import("@/modules/usuarios/application/reactivar-usuario");
await import("@/modules/usuarios/application/dar-de-baja-usuario");
await import("@/modules/usuarios/application/restablecer-credencial");
await import("@/modules/usuarios/application/list-roles-con-permisos");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0002's rol_permiso seed -- the permisos this task's use cases gate on. */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: [
    "usuarios.listar",
    "usuarios.ver",
    "usuarios.crear",
    "usuarios.editar",
    "usuarios.roles.modificar",
    "usuarios.suspender",
    "usuarios.reactivar",
    "usuarios.baja",
    "usuarios.credencial.restablecer",
    "usuarios.auditoria.ver",
    "roles.ver",
  ],
  DIRECTOR_TECNICO: ["usuarios.auditoria.ver"],
  FARMACEUTICO: [],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: [],
};

const TARGET_ID = "22222222-2222-4222-a222-222222222222";

/** One case per plan §7 usuarios action: the use case's registered `name` (== expected `permiso`, since every usuarios use case in this codebase names itself after its permiso), and a zod-schema-valid input so an ALLOWED call gets past validation into the (stubbed-tx) handler. */
const CASES: ReadonlyArray<{ permiso: Permiso; input: unknown }> = [
  { permiso: "usuarios.listar", input: {} },
  { permiso: "usuarios.ver", input: { id: TARGET_ID } },
  { permiso: "usuarios.auditoria.ver", input: { usuarioId: TARGET_ID } },
  { permiso: "usuarios.crear", input: { nombre: "A", apellido: "B", email: "a@b.com", dni: "1", roles: ["FARMACEUTICO"] } },
  {
    permiso: "usuarios.editar",
    input: {
      id: TARGET_ID,
      nombre: "A",
      apellido: "B",
      email: "a@b.com",
      dni: "1",
      version: { nombre: "A", apellido: "B", email: "a@b.com", dni: "1", numeroMatricula: null },
    },
  },
  { permiso: "usuarios.roles.modificar", input: { usuarioId: TARGET_ID, roles: ["FARMACEUTICO"] } },
  { permiso: "usuarios.suspender", input: { usuarioId: TARGET_ID, motivo: "Motivo de prueba." } },
  { permiso: "usuarios.reactivar", input: { usuarioId: TARGET_ID, motivo: "Motivo de prueba." } },
  { permiso: "usuarios.baja", input: { usuarioId: TARGET_ID, motivo: "Motivo de prueba." } },
  { permiso: "usuarios.credencial.restablecer", input: { usuarioId: TARGET_ID } },
  { permiso: "roles.ver", input: {} },
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

describe("FASE 3 (3.1-3.8) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { permiso } of CASES) {
    it(`the use case registered as "${permiso}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === permiso);
      expect(entry, `no registered use case named "${permiso}" -- plan §7 expects one`).toBeDefined();
      expect(entry!.permiso, `use case "${permiso}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 3 (3.1-3.8) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
  for (const rol of ROLES) {
    for (const { permiso, input } of CASES) {
      const expectedAllowed = SEED_GRANTS[rol].includes(permiso);

      it(`${rol} ${expectedAllowed ? "IS" : "is NOT"} allowed to execute "${permiso}"`, async () => {
        const entry = listRegisteredUseCasesForTests().find((e) => e.name === permiso)!;
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
          expect(rejectedWith, `"${permiso}" unexpectedly denied ${rol}`).not.toBeInstanceOf(AuthorizationError);
        } else {
          expect(rejectedWith, `"${permiso}" did not deny ${rol}`).toBeInstanceOf(AuthorizationError);
        }
      });
    }
  }
});
