/**
 * Authorization matrix test for FASE 9 (M12, libro recetario/contralor/
 * histórico): every registered use case's DECLARED permiso matches
 * migration 0002's seed, exercised through the REAL execute() path against
 * every role. Same shape as tests/unit/stock-authorization-matrix.test.ts.
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

vi.mock("@/modules/libro/infrastructure/asiento-repository", () => ({
  listAsientosRecetario: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  getAsientoRecetario: vi.fn(async () => ({
    id: "a1",
    numeroCorrelativo: "1",
    fechaAsiento: "2026-06-15",
    origen: "SISTEMA",
    estado: "VIGENTE",
    pacienteTexto: "P",
    medicoTexto: "M",
    cierreFirmado: false,
    anulacion: null,
    rectificativoNumeroCorrelativo: null,
    asientoOriginalNumeroCorrelativo: null,
    formulaTexto: "F",
    detalles: [],
  })),
  lockAsientoParaAnular: vi.fn(async () => true),
  getAsientoParaAnular: vi.fn(async () => ({ id: "a1", estado: "VIGENTE", cierreDiarioId: null, numeroCorrelativo: "1" })),
  insertAnulacionAsiento: vi.fn(async () => ({ id: "an1" })),
  listLibrosAbiertos: vi.fn(async () => []),
  verificarCadenaLibro: vi.fn(async () => null),
  iterarAsientosParaExportar: vi.fn(async function* () {}),
}));

vi.mock("@/modules/libro/infrastructure/contralor-repository", () => ({
  listAsientosContralor: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  getFechaActivacionContralor: vi.fn(async () => null),
  getLibroContralorId: vi.fn(async () => null),
}));

vi.mock("@/modules/libro/infrastructure/historico-repository", () => ({
  insertAsientoHistorico: vi.fn(async () => ({ id: "h1" })),
  listAsientosHistoricos: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
}));

vi.mock("@/modules/libro/infrastructure/co-firma-repository", () => ({
  listDtVigentesParaCoFirma: vi.fn(async () => []),
  resolveDtCandidato: vi.fn(async () => null),
  esDtVigenteHoy: vi.fn(async () => false),
  recordCoFirmaFailure: vi.fn(async () => undefined),
  recordCoFirmaSuccess: vi.fn(async () => undefined),
}));

await import("@/modules/libro/application/list-asientos-recetario");
await import("@/modules/libro/application/get-asiento-recetario");
await import("@/modules/libro/application/verificar-co-firma-dt");
await import("@/modules/libro/application/list-dt-para-co-firma");
await import("@/modules/libro/application/anular-asiento");
await import("@/modules/libro/application/verificar-cadena-libros");
await import("@/modules/libro/application/list-contralor");
await import("@/modules/libro/application/crear-asiento-historico");
await import("@/modules/libro/application/list-historico");
await import("@/modules/libro/application/exportar-libro");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0002's rol_permiso seed. */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: [],
  DIRECTOR_TECNICO: ["libro.ver", "libro.exportar", "libro.anulacion.solicitar", "libro.anulacion.autorizar", "libro.historico.digitalizar"],
  FARMACEUTICO: ["libro.ver", "libro.exportar", "libro.anulacion.solicitar"],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: ["libro.ver", "libro.exportar"],
};

const DT_ID = "22222222-2222-4222-a222-222222222222";
const ASIENTO_ID = "33333333-3333-4333-a333-333333333333";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "libro.asientos.listar", permiso: "libro.ver", input: {} },
  { name: "libro.asientos.ver", permiso: "libro.ver", input: { id: ASIENTO_ID } },
  { name: "libro.anulacion.verificarCoFirmaDt", permiso: "libro.anulacion.solicitar", input: { dtUsuarioId: DT_ID, password: "x" } },
  { name: "libro.anulacion.dtParaCoFirma", permiso: "libro.anulacion.solicitar", input: {} },
  { name: "libro.asiento.anular", permiso: "libro.anulacion.solicitar", input: { asientoId: ASIENTO_ID, motivo: "Paciente no retira", autorizadoPorId: DT_ID } },
  { name: "libro.integridad.verificar", permiso: "libro.ver", input: {} },
  { name: "libro.contralor.listar", permiso: "libro.ver", input: {} },
  {
    name: "libro.historico.crear",
    permiso: "libro.historico.digitalizar",
    input: { tipoLibro: "RECETARIO", numeroAsientoFisico: "45", fechaAsiento: "2020-01-01", formulaTexto: "F" },
  },
  { name: "libro.historico.listar", permiso: "libro.ver", input: {} },
  { name: "libro.exportar.datos", permiso: "libro.exportar", input: {} },
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

describe("FASE 9 (libro) authorization matrix -- every use case's DECLARED permiso matches migration 0002", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 9 (libro) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
