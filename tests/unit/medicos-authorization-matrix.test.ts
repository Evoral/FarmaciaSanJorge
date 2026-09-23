/**
 * Authorization matrix test for FASE 4 point 4.4 (médicos), per plan §7.
 * Every action shares ONE permiso, `medicos.gestionar` (plan: "medicos.*"),
 * granted to ATP/FAR/DT (NOT ADM -- unlike proveedores/drogas) -- see
 * prisma/migrations/*_0002_usuarios_roles_permisos/migration.sql's seed
 * grants.
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

await import("@/modules/medicos/application/crear-medico");
await import("@/modules/medicos/application/editar-medico");
await import("@/modules/medicos/application/dar-de-baja-medico");
await import("@/modules/medicos/application/reactivar-medico");
await import("@/modules/medicos/application/list-medicos");
await import("@/modules/medicos/application/get-medico");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: [],
  DIRECTOR_TECNICO: ["medicos.gestionar"],
  FARMACEUTICO: ["medicos.gestionar"],
  ATENCION_PUBLICO: ["medicos.gestionar"],
  SOLO_CONSULTA: [],
};

const TARGET_ID = "22222222-2222-4222-a222-222222222222";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "medicos.crear", permiso: "medicos.gestionar", input: { nombre: "N", apellido: "A", matricula: "MAT-1" } },
  {
    name: "medicos.editar",
    permiso: "medicos.gestionar",
    input: {
      id: TARGET_ID,
      nombre: "N",
      apellido: "A",
      matricula: "MAT-1",
      version: { nombre: "N", apellido: "A", matricula: "MAT-1", especialidad: null, telefono: null, direccionRegistrada: null },
    },
  },
  { name: "medicos.baja", permiso: "medicos.gestionar", input: { id: TARGET_ID, motivo: "Motivo de prueba." } },
  { name: "medicos.reactivar", permiso: "medicos.gestionar", input: { id: TARGET_ID, motivo: "Motivo de prueba." } },
  { name: "medicos.listar", permiso: "medicos.gestionar", input: {} },
  { name: "medicos.ver", permiso: "medicos.gestionar", input: { id: TARGET_ID } },
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

describe("FASE 4 point 4.4 (médicos) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 4 point 4.4 (médicos) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
