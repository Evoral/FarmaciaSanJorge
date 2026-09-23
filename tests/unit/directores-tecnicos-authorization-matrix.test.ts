/**
 * Authorization matrix test for FASE 3 point 3.9 (modules/directores-tecnicos/**).
 * Same pattern as tests/unit/farmacia-authorization-matrix.test.ts / parametros-
 * authorization-matrix.test.ts (which see for the full rationale): a
 * declared-permiso check per registered use case, plus a role x permiso
 * matrix exercised through the REAL execute() path (mocked tx/audit/session,
 * no real database), asserting exactly what migration 0002's rol_permiso
 * seed grants -- `dt.designar`/`dt.cesar` to ADMINISTRADOR only, nothing to
 * the other four roles.
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
await import("@/modules/directores-tecnicos/application/designar-director-tecnico");
await import("@/modules/directores-tecnicos/application/cesar-designacion");
await import("@/modules/directores-tecnicos/application/list-usuarios-elegibles");
await import("@/modules/directores-tecnicos/application/dt-vigente-hoy");
await import("@/modules/directores-tecnicos/application/list-designaciones");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0002's rol_permiso seed. */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["dt.designar", "dt.cesar"],
  DIRECTOR_TECNICO: [],
  FARMACEUTICO: [],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: [],
};

const TARGET_ID = "22222222-2222-4222-a222-222222222222";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  {
    name: "dt.designar",
    permiso: "dt.designar",
    input: { usuarioId: TARGET_ID, caracter: "TITULAR", matricula: "MAT-1", vigenteDesde: "2026-01-01" },
  },
  {
    name: "dt.cesar",
    permiso: "dt.cesar",
    input: { designacionId: TARGET_ID, vigenteHasta: "2026-06-30", motivoCese: "renuncia" },
  },
  { name: "dt.usuariosElegibles", permiso: "dt.designar", input: {} },
  { name: "dt.vigenteHoy", permiso: "dt.designar", input: {} },
  { name: "dt.listar", permiso: "dt.designar", input: {} },
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

describe("FASE 3.9 (modules/directores-tecnicos) authorization matrix -- declared permiso", () => {
  for (const { name, permiso } of CASES) {
    it(`use case "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 3.9 (modules/directores-tecnicos) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
