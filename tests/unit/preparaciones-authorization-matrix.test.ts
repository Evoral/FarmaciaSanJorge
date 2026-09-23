/**
 * Authorization matrix test for FASE 8 (M11, preparaciones + etiquetas):
 * every registered use case's DECLARED permiso matches plan §7 / migration
 * 0002's seed (`rol_permiso`: FARMACEUTICO + DIRECTOR_TECNICO ONLY),
 * exercised through the REAL execute() path against every role. Same shape
 * as tests/unit/stock-authorization-matrix.test.ts.
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

const FICHA_ID = "11111111-1111-4111-a111-111111111111";
const PREPARACION_ID = "22222222-2222-4222-a222-222222222222";
const LINEA_ID = "33333333-3333-4333-a333-333333333333";
const PARTIDA_ID = "44444444-4444-4444-a444-444444444444";
const ETIQUETA_ID = "55555555-5555-4555-a555-555555555555";

// Every repository function used by any registered use case in this module,
// stubbed to a harmless default so an ALLOWED role's execute() reaches (and
// returns from) the handler instead of throwing a TypeError on an unmocked
// call -- the assertion below only checks "did NOT throw AuthorizationError".
// DB-shaped behavior is covered by tests/db and the m3-lock-order test.
vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", () => ({
  jornadaActualTenant: vi.fn(async () => "2026-06-15"),
  lockFichaTecnicaParaIniciar: vi.fn(async () => true),
  getFichaParaIniciar: vi.fn(async () => ({ id: FICHA_ID, itemRecetaId: "item-1", recetaId: "receta-1", recetaEstado: "PENDIENTE_PREPARACION" })),
  getPreparacionActivaDeFicha: vi.fn(async () => null),
  insertPreparacion: vi.fn(async () => ({ id: PREPARACION_ID })),
  lockPreparacionParaAccion: vi.fn(async () => true),
  getPreparacionParaAccion: vi.fn(async () => ({ id: PREPARACION_ID, fichaTecnicaId: FICHA_ID, itemRecetaId: "item-1", estado: "INICIADA" })),
  updatePreparacionDescartada: vi.fn(async () => undefined),
  lockRecetaParaTransicion: vi.fn(async () => true),
  getRecetaEstado: vi.fn(async () => "EN_PREPARACION"),
  updateRecetaEstado: vi.fn(async () => undefined),
  todosLosItemsConfirmados: vi.fn(async () => false),
  getLineasParaPreparacion: vi.fn(async () => [
    { id: LINEA_ID, drogaId: "droga-1", drogaNombre: "Droga", cantidadAPesar: "10", unidadMedidaId: "u1", unidadSimbolo: "g", esEnraseManual: false, orden: 0 },
  ]),
  listPartidasElegiblesDroga: vi.fn(async () => [{ id: PARTIDA_ID, lote: "L1", cantidadDisponible: "100", fechaVencimiento: "2099-12-31", fechaApertura: null }]),
  getRecetaContextoAsiento: vi.fn(async () => ({
    recetaId: "receta-1",
    pacienteNombre: "N",
    pacienteApellido: "A",
    medicoNombre: "N",
    medicoApellido: "A",
    medicoMatricula: "MAT-1",
  })),
  existeCierreParaJornada: vi.fn(async () => false),
  lockPartidasParaConfirmacion: vi.fn(async () => [PARTIDA_ID]),
  getPartidasFrescas: vi.fn(async () => [{ id: PARTIDA_ID, drogaId: "droga-1", lote: "L1", cantidadDisponible: "100", fechaVencimiento: "2099-12-31", fechaApertura: null }]),
  insertEgresoPreparacion: vi.fn(async () => ({ id: "mov-1" })),
  getDrogaTipoControl: vi.fn(async () => ({ tipoControl: "NINGUNO", nombre: "Droga", unidadBaseId: "u1" })),
  getFechaActivacionContralor: vi.fn(async () => null),
  insertAsientoRecetario: vi.fn(async () => ({ id: "asiento-1", numeroCorrelativo: "1" })),
  insertAsientoContralorEgreso: vi.fn(async () => ({ id: "contralor-1" })),
  updatePreparacionConfirmada: vi.fn(async () => undefined),
  getPreparacionParaEtiqueta: vi.fn(async () => ({
    id: PREPARACION_ID,
    confirmadaEn: new Date(),
    preparadaPorNombre: "N",
    preparadaPorApellido: "A",
    itemDescripcion: "Crema",
    formaFarmaceutica: "CREMA",
    cantidadUnidades: 1,
    pacienteTexto: "A, N",
    medicoTexto: "A, N — matrícula MAT-1",
    formulaTexto: "x",
    asientoNumeroCorrelativo: "1",
    tenantRazonSocial: "Farmacia",
    tenantNombreFantasia: null,
    tenantMatriculaFarmacia: null,
  })),
  getEtiquetaExistente: vi.fn(async () => null),
  insertEtiqueta: vi.fn(async () => ({ id: ETIQUETA_ID })),
  getEtiquetaParaImprimir: vi.fn(async () => ({ id: ETIQUETA_ID, preparacionId: PREPARACION_ID, contenido: "x", generadaEn: new Date(), impresa: false })),
  marcarEtiquetaImpresa: vi.fn(async () => undefined),
  listPreparaciones: vi.fn(async () => ({ items: [], total: 0 })),
}));

await import("@/modules/preparaciones/application/iniciar-preparacion");
await import("@/modules/preparaciones/application/descartar-preparacion");
await import("@/modules/preparaciones/application/confirmar-preparacion");
await import("@/modules/preparaciones/application/list-preparaciones");
await import("@/modules/preparaciones/application/get-preparacion-para-pantalla");
await import("@/modules/preparaciones/application/generar-etiqueta");
await import("@/modules/preparaciones/application/get-etiqueta-para-imprimir");
await import("@/modules/preparaciones/application/marcar-etiqueta-impresa");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** Verbatim from migration 0002's rol_permiso seed. */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: [],
  DIRECTOR_TECNICO: ["preparaciones.iniciar", "preparaciones.descartar", "preparaciones.confirmar", "etiquetas.generar", "etiquetas.imprimir"],
  FARMACEUTICO: ["preparaciones.iniciar", "preparaciones.descartar", "preparaciones.confirmar", "etiquetas.generar", "etiquetas.imprimir"],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: [],
};

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "preparaciones.iniciar", permiso: "preparaciones.iniciar", input: { fichaTecnicaId: FICHA_ID } },
  { name: "preparaciones.descartar", permiso: "preparaciones.descartar", input: { preparacionId: PREPARACION_ID, motivo: "Motivo de prueba" } },
  {
    name: "preparaciones.confirmar",
    permiso: "preparaciones.confirmar",
    input: { preparacionId: PREPARACION_ID, lineas: [{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_ID] }] },
  },
  { name: "preparaciones.listar", permiso: "preparaciones.iniciar", input: {} },
  { name: "preparaciones.pantalla", permiso: "preparaciones.iniciar", input: { preparacionId: PREPARACION_ID } },
  { name: "etiquetas.generar", permiso: "etiquetas.generar", input: { preparacionId: PREPARACION_ID } },
  { name: "etiquetas.imprimir.datos", permiso: "etiquetas.imprimir", input: { preparacionId: PREPARACION_ID } },
  { name: "etiquetas.marcarImpresa", permiso: "etiquetas.imprimir", input: { etiquetaId: ETIQUETA_ID } },
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

describe("FASE 8 (preparaciones/etiquetas) authorization matrix -- every use case's DECLARED permiso matches plan §7", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("FASE 8 (preparaciones/etiquetas) authorization matrix -- role x permiso, exercised through the REAL execute() path", () => {
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
