/**
 * P3-02 regression tests: Single-statement id-ordered locks for lines and excipient (audit P3-02).
 *
 * Audit finding P3-02:
 * - `planificarConsumoEnTx` with `partidasAdicionales` locks all partidas (lines + excipient) in ONE statement
 *   ordered by id to prevent AB-BA deadlocks between concurrent preparaciones sharing drug and excipient lots.
 * - `reservarStockPreparacion`, `recalcularReservaStock`, and `registrarPerdidaReserva` pass the excipient's
 *   candidate partidas to be locked in that same statement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dec } from "@/shared/decimal";

const lockPartidasParaConfirmacionMock = vi.fn();
const getLineasParaPreparacionMock = vi.fn();
const getPartidasFrescasMock = vi.fn();
const listPartidasElegiblesDrogaMock = vi.fn();

const repo = {
  lockPartidasParaConfirmacion: (...args: unknown[]) => lockPartidasParaConfirmacionMock(...args),
  getLineasParaPreparacion: (...args: unknown[]) => getLineasParaPreparacionMock(...args),
  getPartidasFrescas: (...args: unknown[]) => getPartidasFrescasMock(...args),
  listPartidasElegiblesDroga: (...args: unknown[]) => listPartidasElegiblesDrogaMock(...args),
  getParametrosPesadaReal: vi.fn(async () => ({
    precisionBalanza: "0.001",
    toleranciaPorcentaje: "5",
  })),
  getFechaActivacionContralor: vi.fn(async () => null),
  getDrogaTipoControl: vi.fn(async () => ({ tipoControl: "NINGUNO", clase: "DROGA", nombre: "Droga 1", unidadBaseId: "u-1" })),
  lockPreparacionParaAccion: vi.fn(),
  iniciarPreparacionEnTx: vi.fn(),
  jornadaActualTenant: vi.fn(async () => "2026-10-23"),
  insertReservas: vi.fn(),
};

vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", () => repo);

const TENANT_ID = "00000000-0000-4000-a000-000000000001";
const PREPARACION_ID = "11111111-1111-4111-a111-111111111111";
const FICHA_ID = "22222222-2222-4222-a222-222222222222";
const JORNADA = "2026-10-23";
const DROGA_ID = "33333333-3333-4333-a333-333333333333";
const UNIDAD_G = { id: "u-1", tipoMagnitud: "MASA" as const, factorABase: "1", simbolo: "g" };

const PARTIDA_DROGA = "d0000000-0000-4000-a000-000000000001";
const PARTIDA_EXCIPIENTE = "e0000000-0000-4000-a000-000000000002";

describe("P3-02: planificarConsumoEnTx locks all partidas in one statement", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getLineasParaPreparacionMock.mockResolvedValue([
      {
        id: "linea-1",
        orden: 0,
        drogaId: DROGA_ID,
        drogaNombre: "Droga 1",
        tipoControl: "NINGUNO",
        esControlada: false,
        cantidadAPesar: "10",
        unidad: UNIDAD_G,
        unidadSimbolo: "g",
        unidadStock: UNIDAD_G,
        esEnraseManual: false,
        esPrincipioActivo: true,
      },
    ]);

    listPartidasElegiblesDrogaMock.mockResolvedValue([
      {
        id: PARTIDA_DROGA,
        drogaId: DROGA_ID,
        lote: "L-DROGA-1",
        cantidadDisponible: "100",
        fechaVencimiento: "2027-01-01",
        fechaApertura: "2026-01-01",
        purezaDeclaradaPorcentaje: null,
      },
    ]);

    lockPartidasParaConfirmacionMock.mockImplementation(async (_tx, _tenantId, ids: string[]) => ids);

    getPartidasFrescasMock.mockResolvedValue([
      {
        id: PARTIDA_DROGA,
        drogaId: DROGA_ID,
        lote: "L-DROGA-1",
        cantidadDisponible: "100",
        fechaVencimiento: "2027-01-01",
        fechaApertura: "2026-01-01",
        purezaDeclaradaPorcentaje: null,
      },
    ]);
  });

  it("locks line partidas and partidasAdicionales (excipient) in a single lock call", async () => {
    const { planificarConsumoEnTx } = await import("@/modules/preparaciones/application/confirmar-preparacion");

    const fakeTx = {} as never;

    await planificarConsumoEnTx(fakeTx, TENANT_ID, {
      preparacionId: PREPARACION_ID,
      fichaTecnicaId: FICHA_ID,
      seleccion: {
        modo: "automatica",
        entradas: [{ lineaPesajeId: "linea-1", cantidadReal: dec("10") }],
      },
      jornada: JORNADA,
      partidasAdicionales: [PARTIDA_EXCIPIENTE],
    });

    // Verify lockPartidasParaConfirmacion was called exactly ONCE
    expect(lockPartidasParaConfirmacionMock).toHaveBeenCalledTimes(1);

    // Verify both the drug partida and the excipient partida were passed together
    const [txArg, tenantIdArg, lockedIds] = lockPartidasParaConfirmacionMock.mock.calls[0];
    expect(txArg).toBe(fakeTx);
    expect(tenantIdArg).toBe(TENANT_ID);
    expect(lockedIds).toContain(PARTIDA_DROGA);
    expect(lockedIds).toContain(PARTIDA_EXCIPIENTE);
  });

  it("without partidasAdicionales only line partidas are locked", async () => {
    const { planificarConsumoEnTx } = await import("@/modules/preparaciones/application/confirmar-preparacion");

    const fakeTx = {} as never;

    await planificarConsumoEnTx(fakeTx, TENANT_ID, {
      preparacionId: PREPARACION_ID,
      fichaTecnicaId: FICHA_ID,
      seleccion: {
        modo: "automatica",
        entradas: [{ lineaPesajeId: "linea-1", cantidadReal: dec("10") }],
      },
      jornada: JORNADA,
    });

    expect(lockPartidasParaConfirmacionMock).toHaveBeenCalledTimes(1);
    const [, , lockedIds] = lockPartidasParaConfirmacionMock.mock.calls[0];
    expect(lockedIds).toEqual([PARTIDA_DROGA]);
    expect(lockedIds).not.toContain(PARTIDA_EXCIPIENTE);
  });
});
