/**
 * Authorization matrix test for FASE 11 (M14, entregas/regularización), per
 * plan §7 / migration 0002's seed grants:
 *   - entregas.registrar / entregas.firma.confirmar / regularizacion.ver:
 *     ATENCION_PUBLICO, FARMACEUTICO, DIRECTOR_TECNICO.
 * Same shape as tests/unit/recetas-authorization-matrix.test.ts.
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

await import("@/modules/entregas/application/registrar-entrega");
await import("@/modules/entregas/application/marcar-lista-para-retirar");
await import("@/modules/entregas/application/confirmar-firma-recibida");
await import("@/modules/entregas/application/list-entregas-pendientes");
await import("@/modules/entregas/application/list-regularizacion");
await import("@/modules/entregas/application/get-entrega-estado");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: [],
  DIRECTOR_TECNICO: ["entregas.registrar", "entregas.firma.confirmar", "regularizacion.ver"],
  FARMACEUTICO: ["entregas.registrar", "entregas.firma.confirmar", "regularizacion.ver"],
  ATENCION_PUBLICO: ["entregas.registrar", "entregas.firma.confirmar", "regularizacion.ver"],
  SOLO_CONSULTA: [],
};

const RECETA_ID = "22222222-2222-4222-a222-222222222222";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "entregas.registrar", permiso: "entregas.registrar", input: { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL" } },
  { name: "entregas.listaParaRetirar.marcar", permiso: "entregas.registrar", input: { recetaId: RECETA_ID } },
  { name: "entregas.firma.confirmar", permiso: "entregas.firma.confirmar", input: { recetaId: RECETA_ID } },
  { name: "entregas.pendientes.listar", permiso: "entregas.registrar", input: {} },
  { name: "entregas.estado.ver", permiso: "entregas.registrar", input: { recetaId: RECETA_ID } },
  { name: "regularizacion.listar", permiso: "regularizacion.ver", input: {} },
  { name: "regularizacion.resumen", permiso: "regularizacion.ver", input: {} },
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

describe("FASE 11 (entregas/regularizacion) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 11 (entregas/regularizacion) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
