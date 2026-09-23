/**
 * Authorization matrix test for M08/M10 FASE 7.4 (modules/precios), per
 * plan §7 / migration 0002's seed grants:
 *   - precios.reglas.editar: ADMINISTRADOR, DIRECTOR_TECNICO ONLY.
 *   - cotizaciones.calcular: ATENCION_PUBLICO, FARMACEUTICO, DIRECTOR_TECNICO.
 *   - cotizaciones.ver: ATENCION_PUBLICO, FARMACEUTICO, DIRECTOR_TECNICO.
 * `precios.reglas.consultar` (the history/current-margin read) is declared
 * with `precios.reglas.editar` on its own merits -- same convention as
 * `fichas.versiones.listar` in tests/unit/elaboracion-authorization-matrix.test.ts.
 * Same structure/mocking as that file.
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

await import("@/modules/precios/application/guardar-regla-precio");
await import("@/modules/precios/application/get-reglas-precio");
await import("@/modules/precios/application/calcular-cotizacion");
await import("@/modules/precios/application/get-cotizacion-item");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["precios.reglas.editar"],
  DIRECTOR_TECNICO: ["precios.reglas.editar", "cotizaciones.calcular", "cotizaciones.ver"],
  FARMACEUTICO: ["cotizaciones.calcular", "cotizaciones.ver"],
  ATENCION_PUBLICO: ["cotizaciones.calcular", "cotizaciones.ver"],
  SOLO_CONSULTA: [],
};

const TARGET_ID = "33333333-3333-4333-a333-333333333333";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "precios.reglas.editar", permiso: "precios.reglas.editar", input: { margen: "300" } },
  { name: "precios.reglas.consultar", permiso: "precios.reglas.editar", input: {} },
  { name: "cotizaciones.calcular", permiso: "cotizaciones.calcular", input: { itemRecetaId: TARGET_ID } },
  { name: "cotizaciones.item.consultar", permiso: "cotizaciones.ver", input: { itemRecetaId: TARGET_ID } },
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

describe("M08/M10 (precios / cotizaciones) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("M08/M10 (precios / cotizaciones) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
