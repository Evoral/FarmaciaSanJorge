import { describe, it, expect, vi, beforeEach } from "vitest";
import { DomainError } from "@/shared/errors";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true }),
}));
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called");
  }),
  requireRecentReauth: vi.fn(),
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const FICHA_ID = "22222222-2222-4222-a222-222222222222";
const PREPARACION_ID = "33333333-3333-4333-a333-333333333333";
const LINEA_ID = "44444444-4444-4444-a444-444444444444";
const PARTIDA_UI = "55555555-5555-4555-a555-555555555551";
const PARTIDA_GRAM = "55555555-5555-4555-a555-555555555552";
const DROGA_ID = "77777777-7777-4777-a777-777777777777";
const JORNADA = "2026-11-24";

const GRAMO = { id: "u-g", simbolo: "g", factorABase: "1", tipoMagnitud: "MASA" };
const UI = { factorABase: "1", tipoMagnitud: "ACTIVIDAD" };

const repo = {
  lockPreparacionParaAccion: vi.fn(async () => true),
  getPreparacionParaAccion: vi.fn(async () => ({ id: PREPARACION_ID, fichaTecnicaId: FICHA_ID, itemRecetaId: "item-1", estado: "INICIADA" })),
  jornadaActualTenant: vi.fn(async () => JORNADA),
  existeCierreParaJornada: vi.fn(async () => false),
  getMesesVencimientoPreparado: vi.fn(async () => 3),
  getLineasParaPreparacion: vi.fn(async () => [] as unknown[]),
  lockPartidasParaConfirmacion: vi.fn(async (_tx: unknown, _tenant: string, ids: string[]) => [...ids]),
  getPartidasFrescas: vi.fn(async () => [] as unknown[]),
  listPartidasElegiblesDroga: vi.fn(async () => [] as unknown[]),
  getParametrosPesadaReal: vi.fn(async () => ({ precisionBalanza: "0.001", toleranciaPorcentaje: "5" })),
};

vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", () => repo);

const { planificarConsumoEnTx } = await import("@/modules/preparaciones/application/confirmar-preparacion");

function makeLinea(overrides: Record<string, unknown> = {}) {
  return {
    id: LINEA_ID,
    drogaId: DROGA_ID,
    drogaNombre: "Vitamina D3",
    cantidadAPesar: "50000",
    unidadMedidaId: "u-ui",
    unidadSimbolo: "U.I.",
    unidad: UI,
    unidadStock: GRAMO,
    esEnraseManual: false,
    cantidadPrescripta: null,
    orden: 0,
    seDosificaEnUi: true,
    ...overrides,
  };
}

function makePartida(id: string, cantidadDisponible: string, actividadDeclarada: string | null) {
  return {
    id,
    drogaId: DROGA_ID,
    lote: id.slice(-4),
    cantidadDisponible,
    fechaVencimiento: "2099-12-31",
    fechaApertura: null,
    potenciaDeclarada: null,
    actividadDeclarada,
    elaborada: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("planificarConsumoEnTx -- equivalenciaManual guard (UI7)", () => {
  it("refuses equivalenciaManual when compatible U.I. stock covers the ACTIVIDAD line", async () => {
    const linea = makeLinea({ cantidadAPesar: "50000" });
    const uiPartida = makePartida(PARTIDA_UI, "10", "100000"); // 1,000,000 U.I. >= 50,000 U.I.
    repo.getLineasParaPreparacion.mockResolvedValue([linea]);
    repo.listPartidasElegiblesDroga.mockResolvedValue([uiPartida]);
    repo.getPartidasFrescas.mockResolvedValue([uiPartida]);

    await expect(
      planificarConsumoEnTx({} as never, TENANT_ID, {
        preparacionId: PREPARACION_ID,
        fichaTecnicaId: FICHA_ID,
        jornada: JORNADA,
        seleccion: {
          modo: "automatica",
          entradas: [{ lineaPesajeId: LINEA_ID, equivalenciaManual: true, cantidadManual: "0.5" as never }],
        },
      }),
    ).rejects.toThrow(DomainError);

    await expect(
      planificarConsumoEnTx({} as never, TENANT_ID, {
        preparacionId: PREPARACION_ID,
        fichaTecnicaId: FICHA_ID,
        jornada: JORNADA,
        seleccion: {
          modo: "automatica",
          entradas: [{ lineaPesajeId: LINEA_ID, equivalenciaManual: true, cantidadManual: "0.5" as never }],
        },
      }),
    ).rejects.toThrow(/Hay stock con equivalencia: la línea se calcula con el lote/);
  });

  it("refuses equivalenciaManual when compatible gram stock covers a MASA line of a marked droga", async () => {
    const linea = makeLinea({
      cantidadAPesar: "5",
      unidadMedidaId: "u-g",
      unidadSimbolo: "g",
      unidad: GRAMO,
    });
    const gramPartida = makePartida(PARTIDA_GRAM, "10", null);
    repo.getLineasParaPreparacion.mockResolvedValue([linea]);
    repo.listPartidasElegiblesDroga.mockResolvedValue([gramPartida]);
    repo.getPartidasFrescas.mockResolvedValue([gramPartida]);

    await expect(
      planificarConsumoEnTx({} as never, TENANT_ID, {
        preparacionId: PREPARACION_ID,
        fichaTecnicaId: FICHA_ID,
        jornada: JORNADA,
        seleccion: {
          modo: "automatica",
          entradas: [{ lineaPesajeId: LINEA_ID, equivalenciaManual: true, cantidadManual: "5" as never }],
        },
      }),
    ).rejects.toThrow(/Hay stock con equivalencia: la línea se calcula con el lote/);
  });

  it("accepts equivalenciaManual when no compatible partida exists (ACTIVIDAD line with only gram lots)", async () => {
    const linea = makeLinea({ cantidadAPesar: "50000" });
    const gramPartida = makePartida(PARTIDA_GRAM, "10", null);
    repo.getLineasParaPreparacion.mockResolvedValue([linea]);
    repo.listPartidasElegiblesDroga.mockResolvedValue([gramPartida]);
    repo.getPartidasFrescas.mockResolvedValue([gramPartida]);

    const plan = await planificarConsumoEnTx({} as never, TENANT_ID, {
      preparacionId: PREPARACION_ID,
      fichaTecnicaId: FICHA_ID,
      jornada: JORNADA,
      seleccion: {
        modo: "automatica",
        entradas: [{ lineaPesajeId: LINEA_ID, equivalenciaManual: true, cantidadManual: "0.5" as never }],
      },
    });

    expect(plan).toHaveLength(1);
    expect(plan[0]!.totalFisico.toString()).toBe("0.5");
    expect(plan[0]!.split[0]!.potenciaAplicada).toBeNull();
    expect(plan[0]!.split[0]!.actividadAplicada).toBeNull();
  });

  it("accepts equivalenciaManual when compatible U.I. stock exists but is insufficient (faltante)", async () => {
    const linea = makeLinea({ cantidadAPesar: "500000" });
    const uiPartida = makePartida(PARTIDA_UI, "3", "100000"); // 300,000 U.I. < 500,000 U.I.
    repo.getLineasParaPreparacion.mockResolvedValue([linea]);
    repo.listPartidasElegiblesDroga.mockResolvedValue([uiPartida]);
    repo.getPartidasFrescas.mockResolvedValue([uiPartida]);

    const plan = await planificarConsumoEnTx({} as never, TENANT_ID, {
      preparacionId: PREPARACION_ID,
      fichaTecnicaId: FICHA_ID,
      jornada: JORNADA,
      seleccion: {
        modo: "automatica",
        entradas: [{ lineaPesajeId: LINEA_ID, equivalenciaManual: true, cantidadManual: "2.5" as never }],
      },
    });

    expect(plan).toHaveLength(1);
    expect(plan[0]!.totalFisico.toString()).toBe("2.5");
    expect(plan[0]!.split[0]!.potenciaAplicada).toBeNull();
    expect(plan[0]!.split[0]!.actividadAplicada).toBeNull();
  });
});
