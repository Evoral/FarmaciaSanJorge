/**
 * Authorization matrix test for FASE 7 (M10, elaboración de ficha técnica),
 * per plan §7 / migration 0002's seed grants:
 *   - fichas.generar: FARMACEUTICO, DIRECTOR_TECNICO ONLY.
 *   - fichas.imprimir: FARMACEUTICO, DIRECTOR_TECNICO ONLY.
 * Neither ADMINISTRADOR, ATENCION_PUBLICO nor SOLO_CONSULTA hold either
 * permiso (plan §7's "Ficha técnica" row lists only FAR, DT) -- unlike
 * modules/recetas, there is no broader permiso to reuse for reads, so
 * `fichas.versiones.listar` (the versions list query) is declared with
 * `fichas.generar` on its own merits (see modules/elaboracion/application/
 * list-versiones-ficha.ts's doc comment), asserted here like any other case.
 * Same structure/mocking as tests/unit/recetas-authorization-matrix.test.ts.
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

await import("@/modules/elaboracion/application/generar-ficha-tecnica");
await import("@/modules/elaboracion/application/list-versiones-ficha");
await import("@/modules/elaboracion/application/get-ficha-para-imprimir");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: [],
  DIRECTOR_TECNICO: ["fichas.generar", "fichas.imprimir"],
  FARMACEUTICO: ["fichas.generar", "fichas.imprimir"],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: [],
};

const TARGET_ID = "22222222-2222-4222-a222-222222222222";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "fichas.generar", permiso: "fichas.generar", input: { itemRecetaId: TARGET_ID } },
  { name: "fichas.versiones.listar", permiso: "fichas.generar", input: { itemRecetaId: TARGET_ID } },
  { name: "fichas.imprimir.datos", permiso: "fichas.imprimir", input: { id: TARGET_ID } },
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

describe("FASE 7 (fichas técnicas) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 7 (fichas técnicas) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
