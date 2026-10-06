/**
 * Authorization matrix for modules/etiqueta-tamanos/**: managing the sizes is
 * ADMINISTRADOR-only (`config.ver` / `config.editar`, like the rest of
 * Configuración), while resolving/listing the sizes to print on needs only
 * `etiquetas.imprimir` (FARMACEUTICO / DIRECTOR_TECNICO) -- the person who
 * prints is not an administrator. Same pattern as
 * tests/unit/parametros-authorization-matrix.test.ts (see it for the
 * rationale of mocking only the pipeline's edges).
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
await import("@/modules/etiqueta-tamanos/application/crear-etiqueta-tamano");
await import("@/modules/etiqueta-tamanos/application/editar-etiqueta-tamano");
await import("@/modules/etiqueta-tamanos/application/dar-de-baja-etiqueta-tamano");
await import("@/modules/etiqueta-tamanos/application/reactivar-etiqueta-tamano");
await import("@/modules/etiqueta-tamanos/application/list-etiqueta-tamanos");
await import("@/modules/etiqueta-tamanos/application/get-etiqueta-tamano");
await import("@/modules/etiqueta-tamanos/application/list-tamanos-para-imprimir");
await import("@/modules/etiqueta-tamanos/application/get-tamano-para-imprimir");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

const SIZE_ID = "22222222-2222-4222-8222-222222222222";

/** `config.*` is ADMINISTRADOR-only (migration 0046); `etiquetas.imprimir` is FARMACEUTICO + DIRECTOR_TECNICO (migrations 0002/0054). */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["config.ver", "config.editar"],
  DIRECTOR_TECNICO: ["etiquetas.imprimir"],
  FARMACEUTICO: ["etiquetas.imprimir"],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: [],
};

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "etiquetaTamanos.crear", permiso: "config.editar", input: { nombre: "Rollo chico", anchoMm: "50", altoMm: "30" } },
  { name: "etiquetaTamanos.editar", permiso: "config.editar", input: { id: SIZE_ID, nombre: "Rollo chico", anchoMm: "50", altoMm: "30" } },
  { name: "etiquetaTamanos.baja", permiso: "config.editar", input: { id: SIZE_ID, motivo: "Ya no se usa" } },
  { name: "etiquetaTamanos.reactivar", permiso: "config.editar", input: { id: SIZE_ID, motivo: "Se volvió a usar" } },
  { name: "etiquetaTamanos.listar", permiso: "config.ver", input: {} },
  { name: "etiquetaTamanos.ver", permiso: "config.ver", input: { id: SIZE_ID } },
  { name: "etiquetaTamanos.paraImprimir", permiso: "etiquetas.imprimir", input: {} },
  { name: "etiquetaTamanos.paraImprimir.ver", permiso: "etiquetas.imprimir", input: { tamanoId: SIZE_ID } },
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

describe("modules/etiqueta-tamanos authorization matrix -- declared permiso", () => {
  for (const { name, permiso } of CASES) {
    it(`use case "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("modules/etiqueta-tamanos authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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

describe("etiquetaTamanos.paraImprimir -- who prints can see the sizes without being an administrator", () => {
  it("FARMACEUTICO and DIRECTOR_TECNICO may list the sizes but may not manage them", () => {
    for (const rol of ["FARMACEUTICO", "DIRECTOR_TECNICO"] as const) {
      expect(SEED_GRANTS[rol]).toContain("etiquetas.imprimir");
      expect(SEED_GRANTS[rol]).not.toContain("config.editar");
      expect(SEED_GRANTS[rol]).not.toContain("config.ver");
    }
  });
});
