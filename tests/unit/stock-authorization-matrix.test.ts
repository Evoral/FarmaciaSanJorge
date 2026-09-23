/**
 * Authorization matrix test for FASE 5 (M07, stock): every registered use
 * case's DECLARED permiso matches plan §7, exercised through the REAL
 * execute() path against every role. Same shape as
 * tests/unit/drogas-authorization-matrix.test.ts.
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

// Every stock repository function is stubbed to a harmless default so an
// ALLOWED role's execute() reaches (and returns from) the handler instead
// of throwing a TypeError on an unmocked call -- the assertion below only
// checks "did NOT throw AuthorizationError", so any successful resolution
// is enough; DB-shaped behavior is covered by tests/db and
// tests/unit/stock-m3-lock-order.test.ts.
vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  jornadaActualTenant: vi.fn(async () => "2026-06-15"),
  listStockDrogas: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  listPartidasDeDroga: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  getPartidaParaAccion: vi.fn(async () => ({
    id: "p1",
    drogaId: "d1",
    drogaNombre: "D",
    proveedorId: "pv1",
    proveedorRazonSocial: "P",
    lote: "L1",
    costoUnitario: "10",
    cantidadInicial: "100",
    cantidadDisponible: "50",
    fechaIngreso: new Date(),
    fechaVencimiento: new Date("2027-01-01"),
    fechaApertura: null,
  })),
  lockPartidaParaAccion: vi.fn(async () => true),
  getDrogaParaIngreso: vi.fn(async () => ({ id: "d1", unidadBaseId: "u1", tipoControl: "NINGUNO", fechaBaja: null })),
  getProveedorParaIngreso: vi.fn(async () => ({ id: "pv1", fechaBaja: null })),
  convertirUnidad: vi.fn(async () => "100"),
  getFechaActivacionContralor: vi.fn(async () => null),
  insertPartidaConIngreso: vi.fn(async () => ({ id: "p-new" })),
  insertAjuste: vi.fn(async () => ({ id: "mov-1" })),
  updateCostoPartida: vi.fn(async () => true),
  kardexMovimientos: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  alertasBajoMinimo: vi.fn(async () => []),
  alertasPorVencer: vi.fn(async () => []),
  alertasVencidasConSaldo: vi.fn(async () => []),
  getDiasAlertaVencimiento: vi.fn(async () => 30),
}));

vi.mock("@/modules/stock/infrastructure/co-firma-repository", () => ({
  listDtVigentesParaCoFirma: vi.fn(async () => []),
  resolveDtCandidato: vi.fn(async () => null),
  esDtVigenteHoy: vi.fn(async () => false),
  recordCoFirmaFailure: vi.fn(async () => undefined),
  recordCoFirmaSuccess: vi.fn(async () => undefined),
}));

await import("@/modules/stock/application/ingresar-partida");
await import("@/modules/stock/application/list-stock-drogas");
await import("@/modules/stock/application/list-partidas-droga");
await import("@/modules/stock/application/get-partida");
await import("@/modules/stock/application/kardex-movimientos");
await import("@/modules/stock/application/registrar-ajuste");
await import("@/modules/stock/application/corregir-costo-partida");
await import("@/modules/stock/application/alertas-stock");
await import("@/modules/stock/application/list-dt-para-co-firma");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0002's rol_permiso seed (plan §7). */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["stock.ver", "stock.partida.costo.corregir"],
  DIRECTOR_TECNICO: ["stock.ver", "stock.partida.ingresar", "stock.partida.costo.corregir", "stock.ajuste.registrar", "stock.ajuste.autorizar"],
  FARMACEUTICO: ["stock.ver", "stock.partida.ingresar", "stock.ajuste.registrar"],
  ATENCION_PUBLICO: ["stock.ver"],
  SOLO_CONSULTA: ["stock.ver"],
};

const DROGA_ID = "d1";
const PARTIDA_ID = "p1";
const PROVEEDOR_ID = "pv1";
const UNIDAD_ID = "u1";
const DT_ID = "22222222-2222-4222-a222-222222222222";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  {
    name: "stock.partida.ingresar",
    permiso: "stock.partida.ingresar",
    input: {
      drogaId: DROGA_ID,
      proveedorId: PROVEEDOR_ID,
      lote: "L1",
      fechaVencimiento: "2027-01-01",
      cantidadCompra: "5",
      unidadCompraId: UNIDAD_ID,
      costoUnitario: "10",
    },
  },
  { name: "stock.drogas.listar", permiso: "stock.ver", input: {} },
  { name: "stock.partidas.listar", permiso: "stock.ver", input: { drogaId: DROGA_ID } },
  { name: "stock.partida.ver", permiso: "stock.ver", input: { id: PARTIDA_ID } },
  { name: "stock.kardex.listar", permiso: "stock.ver", input: {} },
  { name: "stock.alertas.listar", permiso: "stock.ver", input: {} },
  {
    name: "stock.ajuste.registrar",
    permiso: "stock.ajuste.registrar",
    input: { partidaId: PARTIDA_ID, cantidad: "1", motivoAjuste: "ROTURA", observacion: "obs", autorizadoPorId: DT_ID },
  },
  {
    name: "stock.partida.costo.corregir",
    permiso: "stock.partida.costo.corregir",
    input: { id: PARTIDA_ID, costoUnitarioNuevo: "12", motivo: "Motivo de prueba." },
  },
  { name: "stock.ajuste.dtParaCoFirma", permiso: "stock.ajuste.registrar", input: {} },
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

describe("FASE 5 (stock) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 5 (stock) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
