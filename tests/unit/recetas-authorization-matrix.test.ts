/**
 * Authorization matrix test for FASE 6 (M09, recetas), per plan §7 /
 * migration 0002's seed grants:
 *   - recetas.crear / recetas.editar / recetas.fisica.registrar: ATP, FAR, DT
 *   - recetas.anular: FAR, DT ONLY (unlike the other three -- ATP cannot anular)
 * Reads (recetas.ver/listar/pendientes-fisica.listar/drogas.listar/
 * unidades.listar) reuse `recetas.crear`/`recetas.fisica.registrar` (see
 * modules/recetas/application/get-receta.ts's doc comment) -- same role set
 * as the writes, so this file does not duplicate those cases beyond
 * confirming the DECLARED permiso.
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

await import("@/modules/recetas/application/crear-receta");
await import("@/modules/recetas/application/editar-receta");
await import("@/modules/recetas/application/registrar-recepcion-fisica");
await import("@/modules/recetas/application/anular-receta");
await import("@/modules/recetas/application/get-receta");
await import("@/modules/recetas/application/list-recetas");
await import("@/modules/recetas/application/list-recetas-pendientes-fisica");
await import("@/modules/recetas/application/list-drogas-para-receta");
await import("@/modules/recetas/application/list-unidades-para-receta");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: [],
  DIRECTOR_TECNICO: ["recetas.crear", "recetas.editar", "recetas.anular", "recetas.fisica.registrar"],
  FARMACEUTICO: ["recetas.crear", "recetas.editar", "recetas.anular", "recetas.fisica.registrar"],
  ATENCION_PUBLICO: ["recetas.crear", "recetas.editar", "recetas.fisica.registrar"],
  SOLO_CONSULTA: [],
};

const TARGET_ID = "22222222-2222-4222-a222-222222222222";
const DROGA_ID = "33333333-3333-4333-a333-333333333333";
const UNIDAD_ID = "44444444-4444-4444-a444-444444444444";

const itemMinimo = {
  formaFarmaceutica: "CREMA",
  cantidadUnidades: 1,
  fraccionDosisPorUnidad: "1",
  cantidadTotal: null,
  unidadTotalId: null,
  componentes: [{ drogaId: DROGA_ID, cantidad: "5", unidadMedidaId: UNIDAD_ID, modoExpresion: "TOTAL", esPrincipioActivo: true }],
};

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  {
    name: "recetas.crear",
    permiso: "recetas.crear",
    input: { pacienteId: TARGET_ID, medicoId: TARGET_ID, fechaPrescripcion: "2026-01-01", origen: "PRESENCIAL", items: [itemMinimo] },
  },
  {
    name: "recetas.editar",
    permiso: "recetas.editar",
    input: {
      id: TARGET_ID,
      pacienteId: TARGET_ID,
      medicoId: TARGET_ID,
      fechaPrescripcion: "2026-01-01",
      origen: "PRESENCIAL",
      items: [itemMinimo],
      version: { pacienteId: TARGET_ID, medicoId: TARGET_ID, fechaPrescripcion: "2026-01-01", origen: "PRESENCIAL" },
      itemsVersion: [],
    },
  },
  { name: "recetas.fisica.registrar", permiso: "recetas.fisica.registrar", input: { id: TARGET_ID } },
  { name: "recetas.anular", permiso: "recetas.anular", input: { id: TARGET_ID, motivo: "Motivo de prueba." } },
  { name: "recetas.ver", permiso: "recetas.crear", input: { id: TARGET_ID } },
  { name: "recetas.listar", permiso: "recetas.crear", input: {} },
  { name: "recetas.pendientes-fisica.listar", permiso: "recetas.fisica.registrar", input: {} },
  { name: "recetas.drogas.listar", permiso: "recetas.crear", input: {} },
  { name: "recetas.unidades.listar", permiso: "recetas.crear", input: {} },
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

describe("FASE 6 (recetas) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 6 (recetas) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
