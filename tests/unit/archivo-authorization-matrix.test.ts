/**
 * Authorization matrix test for FASE 12 (M15, archivo/destrucción), per
 * plan §7 / migration 0002's seed grants: `archivo.lotes.gestionar` and
 * `archivo.destruccion.gestionar` are both DIRECTOR_TECNICO-only. Same
 * shape as tests/unit/entregas-authorization-matrix.test.ts.
 *
 * `authorize()` runs BEFORE zod input validation in `defineCommand`/
 * `defineQuery` (shared/usecase.ts), so every case below can use an empty
 * `{}` input regardless of the use case's real schema: a denied role must
 * always reject with `AuthorizationError` no matter what the input looks
 * like, and an allowed role's rejection (if any, e.g. a `ValidationError`
 * from `{}` not matching the real schema, or a runtime error from the fake
 * tx) is explicitly NOT checked here -- only that it is not an
 * AuthorizationError.
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
  withPlatformTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ __fakeTx: true })),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

await import("@/modules/archivo/application/conformar-lote");
await import("@/modules/archivo/application/list-lotes");
await import("@/modules/archivo/application/actualizar-plazos");
await import("@/modules/archivo/application/resumen-destruccion");
await import("@/modules/archivo/application/verificar-password-destruccion");
await import("@/modules/archivo/application/solicitar-destruccion");
await import("@/modules/archivo/application/autorizar-destruccion");
await import("@/modules/archivo/application/registrar-destruccion");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: [],
  DIRECTOR_TECNICO: ["archivo.lotes.gestionar", "archivo.destruccion.gestionar"],
  FARMACEUTICO: [],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: [],
};

const CASES: ReadonlyArray<{ name: string; permiso: Permiso }> = [
  { name: "archivo.lotes.recetasElegibles", permiso: "archivo.lotes.gestionar" },
  { name: "archivo.lotes.conformar", permiso: "archivo.lotes.gestionar" },
  { name: "archivo.lotes.listar", permiso: "archivo.lotes.gestionar" },
  { name: "archivo.lotes.detalle", permiso: "archivo.lotes.gestionar" },
  { name: "archivo.lotes.actualizarPlazos", permiso: "archivo.lotes.gestionar" },
  { name: "archivo.destruccion.resumenPendientes", permiso: "archivo.destruccion.gestionar" },
  { name: "archivo.destruccion.verificarPassword", permiso: "archivo.destruccion.gestionar" },
  { name: "archivo.destruccion.solicitar", permiso: "archivo.destruccion.gestionar" },
  { name: "archivo.destruccion.autorizar", permiso: "archivo.destruccion.gestionar" },
  { name: "archivo.destruccion.registrar", permiso: "archivo.destruccion.gestionar" },
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

describe("FASE 12 (archivo/destrucción) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 12 (archivo/destrucción) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
  for (const rol of ROLES) {
    for (const { name, permiso } of CASES) {
      const expectedAllowed = SEED_GRANTS[rol].includes(permiso);

      it(`${rol} ${expectedAllowed ? "IS" : "is NOT"} allowed to execute "${name}"`, async () => {
        const entry = listRegisteredUseCasesForTests().find((e) => e.name === name)!;
        const session = sessionForRol(rol);

        let rejectedWith: unknown;
        try {
          await entry.execute({}, { session });
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
