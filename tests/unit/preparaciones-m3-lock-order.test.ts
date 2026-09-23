/**
 * M3-discipline unit tests for FASE 8's write commands: lock BEFORE any
 * fresh read that a decision depends on (same discipline as
 * tests/unit/stock-m3-lock-order.test.ts). Also covers: `confirmarPreparacion`
 * maps a raw DB invariant error to a CLEAR SPANISH message (point 8.3's own
 * requirement), never the raw driver text. Mocked repository/tx, no DB --
 * tests/db covers the real SQL/trigger shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError } from "@/shared/errors";
import type { EstadoPreparacion, EstadoReceta } from "@/generated/prisma/enums";

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

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const FICHA_ID = "22222222-2222-4222-a222-222222222222";
const PREPARACION_ID = "33333333-3333-4333-a333-333333333333";
const LINEA_ID = "44444444-4444-4444-a444-444444444444";
const PARTIDA_ID = "55555555-5555-4555-a555-555555555555";
const USUARIO_ID = "66666666-6666-4666-a666-666666666666";

function fakeSession(permiso: string): AuthenticatedSession {
  return {
    usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set([permiso]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const callOrder: string[] = [];

// ------------------------------------------------------------------------
// Shared mock surface for modules/preparaciones/infrastructure/preparacion-repository.ts
// ------------------------------------------------------------------------
const lockFichaTecnicaParaIniciarMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("lockFicha");
  return true;
});
const getFichaParaIniciarMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("readFicha");
  return { id: FICHA_ID, itemRecetaId: "item-1", recetaId: "receta-1", recetaEstado: "PENDIENTE_PREPARACION" as const };
});
const getPreparacionActivaDeFichaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return null;
});
const insertPreparacionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: PREPARACION_ID };
});
const lockRecetaParaTransicionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const getRecetaEstadoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return "PENDIENTE_PREPARACION" as EstadoReceta;
});
const updateRecetaEstadoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const todosLosItemsConfirmadosMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});

const lockPreparacionParaAccionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("lockPreparacion");
  return true;
});
const getPreparacionParaAccionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("readPreparacion");
  return { id: PREPARACION_ID, fichaTecnicaId: FICHA_ID, itemRecetaId: "item-1", estado: "INICIADA" as EstadoPreparacion };
});
const updatePreparacionDescartadaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
const updatePreparacionConfirmadaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});

const jornadaActualTenantMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return "2026-06-15";
});
const existeCierreParaJornadaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const getLineasParaPreparacionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return [
    { id: LINEA_ID, drogaId: "droga-1", drogaNombre: "Droga X", cantidadAPesar: "10", unidadMedidaId: "u1", unidadSimbolo: "g", esEnraseManual: false, orden: 0 },
  ];
});
const listPartidasElegiblesDrogaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return [{ id: PARTIDA_ID, lote: "L1", cantidadDisponible: "100", fechaVencimiento: "2099-12-31", fechaApertura: null }];
});
const lockPartidasParaConfirmacionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("lockPartidas");
  return [PARTIDA_ID];
});
const getPartidasFrescasMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("readPartidasFrescas");
  return [{ id: PARTIDA_ID, drogaId: "droga-1", lote: "L1", cantidadDisponible: "100", fechaVencimiento: "2099-12-31", fechaApertura: null }];
});
const insertEgresoPreparacionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "mov-1" };
});
const getDrogaTipoControlMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { tipoControl: "NINGUNO", nombre: "Droga X", unidadBaseId: "u1" };
});
const getFechaActivacionContralorMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return null;
});
const insertAsientoRecetarioMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "asiento-1", numeroCorrelativo: "1" };
});
const insertAsientoContralorEgresoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "contralor-1" };
});
const getRecetaContextoAsientoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return {
    recetaId: "receta-1",
    pacienteNombre: "Juan",
    pacienteApellido: "Pérez",
    medicoNombre: "Ana",
    medicoApellido: "Gómez",
    medicoMatricula: "MAT-1",
  };
});

vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", () => ({
  lockFichaTecnicaParaIniciar: (...args: unknown[]) => lockFichaTecnicaParaIniciarMock(...args),
  getFichaParaIniciar: (...args: unknown[]) => getFichaParaIniciarMock(...args),
  getPreparacionActivaDeFicha: (...args: unknown[]) => getPreparacionActivaDeFichaMock(...args),
  insertPreparacion: (...args: unknown[]) => insertPreparacionMock(...args),
  lockRecetaParaTransicion: (...args: unknown[]) => lockRecetaParaTransicionMock(...args),
  getRecetaEstado: (...args: unknown[]) => getRecetaEstadoMock(...args),
  updateRecetaEstado: (...args: unknown[]) => updateRecetaEstadoMock(...args),
  todosLosItemsConfirmados: (...args: unknown[]) => todosLosItemsConfirmadosMock(...args),
  lockPreparacionParaAccion: (...args: unknown[]) => lockPreparacionParaAccionMock(...args),
  getPreparacionParaAccion: (...args: unknown[]) => getPreparacionParaAccionMock(...args),
  updatePreparacionDescartada: (...args: unknown[]) => updatePreparacionDescartadaMock(...args),
  updatePreparacionConfirmada: (...args: unknown[]) => updatePreparacionConfirmadaMock(...args),
  jornadaActualTenant: (...args: unknown[]) => jornadaActualTenantMock(...args),
  existeCierreParaJornada: (...args: unknown[]) => existeCierreParaJornadaMock(...args),
  getLineasParaPreparacion: (...args: unknown[]) => getLineasParaPreparacionMock(...args),
  listPartidasElegiblesDroga: (...args: unknown[]) => listPartidasElegiblesDrogaMock(...args),
  lockPartidasParaConfirmacion: (...args: unknown[]) => lockPartidasParaConfirmacionMock(...args),
  getPartidasFrescas: (...args: unknown[]) => getPartidasFrescasMock(...args),
  insertEgresoPreparacion: (...args: unknown[]) => insertEgresoPreparacionMock(...args),
  getDrogaTipoControl: (...args: unknown[]) => getDrogaTipoControlMock(...args),
  getFechaActivacionContralor: (...args: unknown[]) => getFechaActivacionContralorMock(...args),
  insertAsientoRecetario: (...args: unknown[]) => insertAsientoRecetarioMock(...args),
  insertAsientoContralorEgreso: (...args: unknown[]) => insertAsientoContralorEgresoMock(...args),
  getRecetaContextoAsiento: (...args: unknown[]) => getRecetaContextoAsientoMock(...args),
}));

const { iniciarPreparacionCommand } = await import("@/modules/preparaciones/application/iniciar-preparacion");
const { descartarPreparacionCommand } = await import("@/modules/preparaciones/application/descartar-preparacion");
const { confirmarPreparacionCommand } = await import("@/modules/preparaciones/application/confirmar-preparacion");

beforeEach(() => {
  callOrder.length = 0;
  vi.clearAllMocks();
  lockFichaTecnicaParaIniciarMock.mockImplementation(async () => {
    callOrder.push("lockFicha");
    return true;
  });
  getFichaParaIniciarMock.mockImplementation(async () => {
    callOrder.push("readFicha");
    return { id: FICHA_ID, itemRecetaId: "item-1", recetaId: "receta-1", recetaEstado: "PENDIENTE_PREPARACION" as const };
  });
  getPreparacionActivaDeFichaMock.mockResolvedValue(null);
  insertPreparacionMock.mockResolvedValue({ id: PREPARACION_ID });
  lockRecetaParaTransicionMock.mockResolvedValue(true);
  getRecetaEstadoMock.mockResolvedValue("PENDIENTE_PREPARACION" as EstadoReceta);
  updateRecetaEstadoMock.mockResolvedValue(undefined);
  todosLosItemsConfirmadosMock.mockResolvedValue(false);

  lockPreparacionParaAccionMock.mockImplementation(async () => {
    callOrder.push("lockPreparacion");
    return true;
  });
  getPreparacionParaAccionMock.mockImplementation(async () => {
    callOrder.push("readPreparacion");
    return { id: PREPARACION_ID, fichaTecnicaId: FICHA_ID, itemRecetaId: "item-1", estado: "INICIADA" as const };
  });
  updatePreparacionDescartadaMock.mockResolvedValue(undefined);
  updatePreparacionConfirmadaMock.mockResolvedValue(undefined);

  jornadaActualTenantMock.mockResolvedValue("2026-06-15");
  existeCierreParaJornadaMock.mockResolvedValue(false);
  getLineasParaPreparacionMock.mockResolvedValue([
    { id: LINEA_ID, drogaId: "droga-1", drogaNombre: "Droga X", cantidadAPesar: "10", unidadMedidaId: "u1", unidadSimbolo: "g", esEnraseManual: false, orden: 0 },
  ]);
  listPartidasElegiblesDrogaMock.mockResolvedValue([{ id: PARTIDA_ID, lote: "L1", cantidadDisponible: "100", fechaVencimiento: "2099-12-31", fechaApertura: null }]);
  lockPartidasParaConfirmacionMock.mockImplementation(async () => {
    callOrder.push("lockPartidas");
    return [PARTIDA_ID];
  });
  getPartidasFrescasMock.mockImplementation(async () => {
    callOrder.push("readPartidasFrescas");
    return [{ id: PARTIDA_ID, drogaId: "droga-1", lote: "L1", cantidadDisponible: "100", fechaVencimiento: "2099-12-31", fechaApertura: null }];
  });
  insertEgresoPreparacionMock.mockResolvedValue({ id: "mov-1" });
  getDrogaTipoControlMock.mockResolvedValue({ tipoControl: "NINGUNO", nombre: "Droga X", unidadBaseId: "u1" });
  getFechaActivacionContralorMock.mockResolvedValue(null);
  insertAsientoRecetarioMock.mockResolvedValue({ id: "asiento-1", numeroCorrelativo: "1" });
  insertAsientoContralorEgresoMock.mockResolvedValue({ id: "contralor-1" });
  getRecetaContextoAsientoMock.mockResolvedValue({
    recetaId: "receta-1",
    pacienteNombre: "Juan",
    pacienteApellido: "Pérez",
    medicoNombre: "Ana",
    medicoApellido: "Gómez",
    medicoMatricula: "MAT-1",
  });
});

describe("iniciar-preparacion: lock BEFORE reading the ficha's current state", () => {
  it("locks the ficha, then reads it", async () => {
    await iniciarPreparacionCommand.execute({ fichaTecnicaId: FICHA_ID }, { session: fakeSession("preparaciones.iniciar") });
    expect(callOrder).toEqual(["lockFicha", "readFicha"]);
  });

  it("404s when the locked ficha does not exist -- never reads afterward", async () => {
    lockFichaTecnicaParaIniciarMock.mockImplementationOnce(async () => {
      callOrder.push("lockFicha");
      return false;
    });
    let caught: unknown;
    try {
      await iniciarPreparacionCommand.execute({ fichaTecnicaId: FICHA_ID }, { session: fakeSession("preparaciones.iniciar") });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect(getFichaParaIniciarMock).not.toHaveBeenCalled();
  });
});

describe("descartar-preparacion: lock BEFORE reading the preparación's current state", () => {
  it("locks, then reads, then rejects a non-INICIADA preparación", async () => {
    getPreparacionParaAccionMock.mockImplementationOnce(async () => {
      callOrder.push("readPreparacion");
      return { id: PREPARACION_ID, fichaTecnicaId: FICHA_ID, itemRecetaId: "item-1", estado: "CONFIRMADA" as const };
    });
    let caught: unknown;
    try {
      await descartarPreparacionCommand.execute({ preparacionId: PREPARACION_ID, motivo: "Motivo" }, { session: fakeSession("preparaciones.descartar") });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect(callOrder).toEqual(["lockPreparacion", "readPreparacion"]);
    expect(updatePreparacionDescartadaMock).not.toHaveBeenCalled();
  });

  it("succeeds for an INICIADA preparación", async () => {
    await descartarPreparacionCommand.execute({ preparacionId: PREPARACION_ID, motivo: "Motivo" }, { session: fakeSession("preparaciones.descartar") });
    expect(callOrder).toEqual(["lockPreparacion", "readPreparacion"]);
    expect(updatePreparacionDescartadaMock).toHaveBeenCalledTimes(1);
  });
});

describe("confirmar-preparacion: lock ordering (preparación, then partidas)", () => {
  it("locks the preparación, reads it, THEN locks every chosen partida, THEN reads their fresh balances", async () => {
    await confirmarPreparacionCommand.execute(
      { preparacionId: PREPARACION_ID, lineas: [{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_ID] }] },
      { session: fakeSession("preparaciones.confirmar") },
    );
    expect(callOrder).toEqual(["lockPreparacion", "readPreparacion", "lockPartidas", "readPartidasFrescas"]);
  });

  it("preparada_por_id is the SESSION user, never client input (INV-P06)", async () => {
    await confirmarPreparacionCommand.execute(
      { preparacionId: PREPARACION_ID, lineas: [{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_ID] }] },
      { session: fakeSession("preparaciones.confirmar") },
    );
    expect(updatePreparacionConfirmadaMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, PREPARACION_ID, USUARIO_ID);
  });

  it("rejects a non-INICIADA preparación with a clear message, before touching partidas", async () => {
    getPreparacionParaAccionMock.mockImplementationOnce(async () => {
      callOrder.push("readPreparacion");
      return { id: PREPARACION_ID, fichaTecnicaId: FICHA_ID, itemRecetaId: "item-1", estado: "CONFIRMADA" as const };
    });
    let caught: unknown;
    try {
      await confirmarPreparacionCommand.execute(
        { preparacionId: PREPARACION_ID, lineas: [{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_ID] }] },
        { session: fakeSession("preparaciones.confirmar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as Error).message).toContain("INICIADA");
    expect(lockPartidasParaConfirmacionMock).not.toHaveBeenCalled();
  });

  it("rejects with a friendly message when today's jornada already has a cierre_diario (INV-C03 pre-check)", async () => {
    existeCierreParaJornadaMock.mockResolvedValueOnce(true);
    let caught: unknown;
    try {
      await confirmarPreparacionCommand.execute(
        { preparacionId: PREPARACION_ID, lineas: [{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_ID] }] },
        { session: fakeSession("preparaciones.confirmar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as Error).message).toMatch(/firmad/i);
    expect(lockPartidasParaConfirmacionMock).not.toHaveBeenCalled();
  });

  it("maps a raw DB invariant error (INV-S10) to a CLEAR SPANISH DomainError, never the raw driver text", async () => {
    insertEgresoPreparacionMock.mockImplementationOnce(async () => {
      throw { code: "P2010", message: "Raw query failed. Code: `P0001`. Message: `INV-S10: cannot register EGRESO_PREPARACION against expired partida`" };
    });
    let caught: unknown;
    try {
      await confirmarPreparacionCommand.execute(
        { preparacionId: PREPARACION_ID, lineas: [{ lineaPesajeId: LINEA_ID, partidaIds: [PARTIDA_ID] }] },
        { session: fakeSession("preparaciones.confirmar") },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    const message = (caught as Error).message;
    expect(message).not.toContain("cannot register EGRESO_PREPARACION"); // never the raw English trigger text
    expect(message.toLowerCase()).toContain("vencida"); // the Spanish mapping for INV-S10
  });
});
