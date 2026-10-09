/**
 * Units at the línea -> stock boundary (docs/specs/reserva-stock-preparacion.md, R12): a línea de pesaje is in its
 * magnitud's base unit (g), stock is in the droga's unidad base (mg, mcg...). `planificarConsumoEnTx` converts the
 * línea's quantity into the droga's unidad base before the split, so egresos, reservas and the contralor are in the
 * droga's unidad base while the libro recetario and the "faltan X" message stay in the línea's unit. Mocked
 * repository/tx, no DB -- the DB side (INV-S12, migration 0073) is covered by tests/db.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError } from "@/shared/errors";
import { convertirCantidad } from "@/shared/decimal/convertir-unidad";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true }),
}));
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const FICHA_ID = "22222222-2222-4222-a222-222222222222";
const PREPARACION_ID = "33333333-3333-4333-a333-333333333333";
const LINEA_ID = "44444444-4444-4444-a444-444444444444";
const PARTIDA_A = "55555555-5555-4555-a555-555555555551";
const PARTIDA_B = "55555555-5555-4555-a555-555555555552";
const USUARIO_ID = "66666666-6666-4666-a666-666666666666";
const JORNADA = "2026-06-15";

const GRAMO = { factorABase: "1", tipoMagnitud: "MASA" };
const MILIGRAMO = { id: "u-mg", simbolo: "mg", factorABase: "0.001", tipoMagnitud: "MASA" };
const MICROGRAMO = { id: "u-mcg", simbolo: "mcg", factorABase: "0.000001", tipoMagnitud: "MASA" };
const MILILITRO = { id: "u-ml", simbolo: "mL", factorABase: "1", tipoMagnitud: "VOLUMEN" };

const session: AuthenticatedSession = {
  usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["preparaciones.confirmar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

type UnidadStock = typeof MILIGRAMO;

function lineaCafeina(overrides: Record<string, unknown> = {}, unidadStock: UnidadStock = MILIGRAMO) {
  return {
    id: LINEA_ID,
    drogaId: "droga-cafeina",
    drogaNombre: "Cafeína",
    cantidadAPesar: "950",
    unidadMedidaId: "u-g",
    unidadSimbolo: "g",
    unidad: GRAMO,
    unidadStock,
    esEnraseManual: false,
    orden: 0,
    ...overrides,
  };
}

function partida(id: string, cantidadDisponible: string, extra: Record<string, unknown> = {}) {
  return { id, drogaId: "droga-cafeina", lote: id.slice(-1), cantidadDisponible, fechaVencimiento: "2099-12-31", fechaApertura: null, potenciaDeclarada: null, ...extra };
}

const repo = {
  lockPreparacionParaAccion: vi.fn(async () => true),
  getPreparacionParaAccion: vi.fn(async () => ({ id: PREPARACION_ID, fichaTecnicaId: FICHA_ID, itemRecetaId: "item-1", estado: "INICIADA" })),
  jornadaActualTenant: vi.fn(async () => JORNADA),
  existeCierreParaJornada: vi.fn(async () => false),
  getMesesVencimientoPreparado: vi.fn(async () => 3),
  getLineasParaPreparacion: vi.fn(async () => [lineaCafeina()] as unknown[]),
  lockPartidasParaConfirmacion: vi.fn(async (_tx: unknown, _tenant: string, ids: string[]) => [...ids]),
  getPartidasFrescas: vi.fn(async () => [partida(PARTIDA_A, "1000000")] as unknown[]),
  listPartidasElegiblesDroga: vi.fn(async () => [partida(PARTIDA_A, "1000000")] as unknown[]),
  insertEgresoPreparacion: vi.fn(async () => ({ id: "mov-1" })),
  getDrogaTipoControl: vi.fn(async () => ({ tipoControl: "NINGUNO", clase: "DROGA", nombre: "Cafeína", unidadBaseId: MILIGRAMO.id }) as unknown),
  getFechaActivacionContralor: vi.fn(async () => null as Date | null),
  insertAsientoRecetario: vi.fn(async (...args: unknown[]) => {
    void args;
    return { id: "asiento-1", numeroCorrelativo: "1" };
  }),
  insertAsientoContralorEgreso: vi.fn(async () => ({ id: "contralor-1" })),
  updatePreparacionConfirmada: vi.fn(async () => undefined),
  lockRecetaParaTransicion: vi.fn(async () => true),
  getRecetaEstado: vi.fn(async () => "EN_PREPARACION"),
  updateRecetaEstado: vi.fn(async () => undefined),
  todosLosItemsConfirmados: vi.fn(async () => false),
  getRecetaContextoAsiento: vi.fn(async () => ({
    recetaId: "receta-1",
    pacienteNombre: "Juan",
    pacienteApellido: "Pérez",
    medicoNombre: "Ana",
    medicoApellido: "Gómez",
    medicoMatricula: "MAT-1",
  })),
  deleteReservasDePreparacion: vi.fn(async () => 0),
};
vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", () => repo);

const { confirmarPreparacionCommand, planificarConsumoEnTx } = await import("@/modules/preparaciones/application/confirmar-preparacion");
const { reservasDelPlan } = await import("@/modules/preparaciones/application/reservar-stock-preparacion");

beforeEach(() => {
  vi.clearAllMocks();
  repo.getLineasParaPreparacion.mockResolvedValue([lineaCafeina()]);
  repo.getPartidasFrescas.mockResolvedValue([partida(PARTIDA_A, "1000000")]);
  repo.listPartidasElegiblesDroga.mockResolvedValue([partida(PARTIDA_A, "1000000")]);
  repo.getFechaActivacionContralor.mockResolvedValue(null);
  repo.getDrogaTipoControl.mockResolvedValue({ tipoControl: "NINGUNO", clase: "DROGA", nombre: "Cafeína", unidadBaseId: MILIGRAMO.id });
});

async function confirmar(lineas: { lineaPesajeId: string; partidaIds: string[]; cantidadManual?: string }[] = [{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_A] }]) {
  return confirmarPreparacionCommand.execute({ preparacionId: PREPARACION_ID, lineas }, { session });
}

function plan(lineas: { lineaPesajeId: string; partidaIds: string[]; cantidadManual?: string }[] = [{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_A] }]) {
  return planificarConsumoEnTx({} as never, TENANT_ID, {
    preparacionId: PREPARACION_ID,
    fichaTecnicaId: FICHA_ID,
    lineas: lineas.map((l) => ({ ...l, cantidadManual: l.cantidadManual })) as never,
    jornada: JORNADA,
  });
}

describe("convertirCantidad (fsj.convertir's arithmetic)", () => {
  it("converts within a magnitud and refuses across magnitudes", () => {
    expect(convertirCantidad("950", GRAMO, MILIGRAMO).toFixed()).toBe("950000");
    expect(convertirCantidad("950000", MILIGRAMO, GRAMO).toFixed()).toBe("950");
    expect(convertirCantidad("0.5", GRAMO, MICROGRAMO).toFixed()).toBe("500000");
    expect(() => convertirCantidad("1", GRAMO, MILILITRO)).toThrow(RangeError);
  });
});

describe("planificarConsumoEnTx: the línea's quantity is converted into the droga's unidad base", () => {
  it("950 g of a droga kept in mg is split as 950000 mg; the reserva rows hold mg", async () => {
    const [linea] = await plan();
    expect(linea!.cantidadRequerida.toFixed()).toBe("950");
    expect(linea!.cantidadRequeridaStock.toFixed()).toBe("950000");
    expect(linea!.split.map((s) => [s.partidaId, s.cantidad.toFixed()])).toEqual([[PARTIDA_A, "950000"]]);
    expect(linea!.totalFisico.toFixed()).toBe("950");
    expect(reservasDelPlan([linea!])).toEqual([{ lineaPesajeId: LINEA_ID, partidaId: PARTIDA_A, cantidad: "950000", cantidadManual: null, motivoAperturaAdicional: null }]);
  });

  it("spreads over several partidas in mg (600000 + 350000)", async () => {
    repo.getPartidasFrescas.mockResolvedValue([partida(PARTIDA_A, "600000", { fechaApertura: "2026-06-01T10:00:00.000Z" }), partida(PARTIDA_B, "500000")]);
    repo.listPartidasElegiblesDroga.mockResolvedValue([partida(PARTIDA_A, "600000", { fechaApertura: "2026-06-01T10:00:00.000Z" }), partida(PARTIDA_B, "500000")]);
    const [linea] = await plan([{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_A, PARTIDA_B] }]);
    expect(linea!.split.map((s) => [s.partidaId, s.cantidad.toFixed()])).toEqual([
      [PARTIDA_A, "600000"],
      [PARTIDA_B, "350000"],
    ]);
  });

  it("a droga kept in mcg: 0.5 g -> 500000 mcg", async () => {
    repo.getLineasParaPreparacion.mockResolvedValue([lineaCafeina({ drogaNombre: "Ácido tióctico", cantidadAPesar: "0.5" }, MICROGRAMO)]);
    repo.getPartidasFrescas.mockResolvedValue([partida(PARTIDA_A, "2000000")]);
    repo.listPartidasElegiblesDroga.mockResolvedValue([partida(PARTIDA_A, "2000000")]);
    const [linea] = await plan();
    expect(linea!.split.map((s) => s.cantidad.toFixed())).toEqual(["500000"]);
    expect(linea!.totalFisico.toFixed()).toBe("0.5");
  });

  it("insufficient stock: the shortfall is shown in the línea's unit, with the línea's symbol", async () => {
    // 900000 mg = 900 g available for 950 g.
    repo.getPartidasFrescas.mockResolvedValue([partida(PARTIDA_A, "900000")]);
    repo.listPartidasElegiblesDroga.mockResolvedValue([partida(PARTIDA_A, "900000")]);
    await expect(plan()).rejects.toThrow("Stock insuficiente de Cafeína en las partidas elegidas: faltan 50 g.");
  });

  it("a stock that covered the old (unconverted) amount is no longer enough: 950 mg do not cover 950 g", async () => {
    repo.getPartidasFrescas.mockResolvedValue([partida(PARTIDA_A, "950")]);
    repo.listPartidasElegiblesDroga.mockResolvedValue([partida(PARTIDA_A, "950")]);
    await expect(plan()).rejects.toThrow("faltan 949.05 g");
  });

  it("purity correction runs in the droga's unidad base: 950 g active at 95% -> 1000000 mg physical, libro 1000 g", async () => {
    repo.getPartidasFrescas.mockResolvedValue([partida(PARTIDA_A, "2000000", { potenciaDeclarada: "95" })]);
    repo.listPartidasElegiblesDroga.mockResolvedValue([partida(PARTIDA_A, "2000000", { potenciaDeclarada: "95" })]);
    const [linea] = await plan();
    expect(linea!.split.map((s) => [s.cantidad.toFixed(), s.potenciaAplicada?.toFixed()])).toEqual([["1000000", "95"]]);
    expect(linea!.totalFisico.toFixed()).toBe("1000");
  });

  it("enrase manual: the typed quantity is in the línea's unit (the form's) and converted (27 g -> 27000 mg)", async () => {
    repo.getLineasParaPreparacion.mockResolvedValue([lineaCafeina({ drogaNombre: "Vaselina", cantidadAPesar: null, esEnraseManual: true })]);
    const [linea] = await plan([{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_A], cantidadManual: "27" }]);
    expect(linea!.cantidadRequerida.toFixed()).toBe("27");
    expect(linea!.split.map((s) => [s.cantidad.toFixed(), s.potenciaAplicada])).toEqual([["27000", null]]);
    expect(linea!.totalFisico.toFixed()).toBe("27");
    // The reserva keeps the typed quantity as typed: the confirmation rebuilds the same input.
    expect(reservasDelPlan([linea!])[0]).toMatchObject({ cantidad: "27000", cantidadManual: "27" });
  });

  it("refuses a línea whose unit is of another magnitud than the droga's unidad base", async () => {
    repo.getLineasParaPreparacion.mockResolvedValue([lineaCafeina({}, MILILITRO)]);
    await expect(plan()).rejects.toThrow(DomainError);
    await expect(plan()).rejects.toThrow("magnitudes distintas");
  });
});

describe("confirmarPreparacion: stock in the droga's unidad base, libro in the línea's unit", () => {
  it("writes EGRESO_PREPARACION of 950000 (mg) and a libro detalle of 950 g", async () => {
    await confirmar();
    expect(repo.insertEgresoPreparacion).toHaveBeenCalledTimes(1);
    expect(repo.insertEgresoPreparacion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ partidaId: PARTIDA_A, cantidad: "950000" }));

    const asiento = repo.insertAsientoRecetario.mock.calls[0]![1] as { formulaTexto: string; detalles: { cantidad: string; unidadTexto: string }[] };
    expect(asiento.detalles).toEqual([expect.objectContaining({ cantidad: "950", unidadTexto: "g" })]);
    expect(asiento.formulaTexto).toContain("950 g");
  });

  it("the asiento_contralor quantity is in the droga's unidad base (its unidadMedidaId)", async () => {
    repo.getDrogaTipoControl.mockResolvedValue({ tipoControl: "PSICOTROPICO", clase: "DROGA", nombre: "Cafeína", unidadBaseId: MILIGRAMO.id });
    repo.getFechaActivacionContralor.mockResolvedValue(new Date("2026-01-01T00:00:00Z"));
    await confirmar();
    expect(repo.insertAsientoContralorEgreso).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cantidad: "950000", unidadMedidaId: MILIGRAMO.id }));
  });
});
