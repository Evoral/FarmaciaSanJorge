/**
 * Authorization matrix test for FASE 10 (M13a cierre diario): every
 * registered use case's DECLARED permiso matches migration 0002's seed,
 * exercised through the REAL execute() path against every role. Same shape
 * as tests/unit/libro-authorization-matrix.test.ts.
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

vi.mock("@/modules/auth/domain/password", () => ({ verifyPassword: vi.fn(async () => false) }));

vi.mock("@/modules/cierres/infrastructure/cierre-repository", () => ({
  jornadaActualTenant: vi.fn(async () => "2026-06-15"),
  getPlazoFirmaDias: vi.fn(async () => 0),
  listJornadasPendientes: vi.fn(async () => []),
  getResumenPendientes: vi.fn(async () => ({ cantidad: 0, masAntiguaFecha: null })),
  listPreparacionesIniciadas: vi.fn(async () => []),
  getDesignacionVigenteEnFecha: vi.fn(async () => null),
  cargarUsuarioParaPasswordFirma: vi.fn(async () => ({ passwordHash: "hash", estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null })),
  registrarFallaPasswordFirma: vi.fn(async () => undefined),
  registrarExitoPasswordFirma: vi.fn(async () => undefined),
  firmarCierreDb: vi.fn(async () => ({ id: "c1", fecha: "2026-06-15", cantidadAsientos: 0, hashLote: "h", fueraDeTermino: false, motivoDemora: null, fechaFirma: new Date() })),
  listCierres: vi.fn(async () => ({ items: [], total: 0 })),
  getCierreDetalle: vi.fn(async () => null),
  getTenantDatosComprobante: vi.fn(async () => ({ razonSocial: "F", nombreFantasia: null, matriculaFarmacia: null, domicilio: null, cuit: "1" })),
  marcarCierreImpreso: vi.fn(async () => false),
  listCumplimiento: vi.fn(async () => []),
}));

await import("@/modules/cierres/application/list-jornadas-pendientes");
await import("@/modules/cierres/application/list-preparaciones-iniciadas");
await import("@/modules/cierres/application/list-cierres");
await import("@/modules/cierres/application/get-cierre-detalle");
await import("@/modules/cierres/application/verificar-password-firma");
await import("@/modules/cierres/application/firmar-cierre");
await import("@/modules/cierres/application/imprimir-cierre-pdf");
await import("@/modules/cierres/application/reporte-cumplimiento");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0002's rol_permiso seed. */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: [],
  DIRECTOR_TECNICO: ["cierres.ver", "cierres.reporte", "cierres.firmar", "cierres.imprimir"],
  FARMACEUTICO: ["cierres.ver", "cierres.reporte", "cierres.imprimir"],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: ["cierres.ver", "cierres.reporte"],
};

const CIERRE_ID = "33333333-3333-4333-a333-333333333333";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "cierres.jornadas.pendientes", permiso: "cierres.ver", input: {} },
  { name: "cierres.jornadas.resumenPendientes", permiso: "cierres.ver", input: {} },
  { name: "cierres.jornadaActual", permiso: "cierres.ver", input: {} },
  { name: "cierres.preparacionesIniciadas.list", permiso: "cierres.firmar", input: {} },
  { name: "cierres.list", permiso: "cierres.ver", input: {} },
  { name: "cierres.detalle", permiso: "cierres.ver", input: { id: CIERRE_ID } },
  { name: "cierres.jornada.verificarPasswordFirma", permiso: "cierres.firmar", input: { password: "x" } },
  { name: "cierres.jornada.firmar", permiso: "cierres.firmar", input: { fecha: "2026-06-15" } },
  { name: "cierres.imprimir.detalle", permiso: "cierres.imprimir", input: { id: CIERRE_ID } },
  { name: "cierres.imprimir.marcar", permiso: "cierres.imprimir", input: { id: CIERRE_ID } },
  { name: "cierres.reporte.cumplimiento", permiso: "cierres.reporte", input: {} },
  { name: "cierres.reporte.auditarExportacion", permiso: "cierres.reporte", input: { filtroResumen: "x", cantidadFilas: 0 } },
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

describe("FASE 10 (cierres) authorization matrix -- every use case's DECLARED permiso matches migration 0002", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 10 (cierres) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
