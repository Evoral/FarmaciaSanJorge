import { describe, it, expect, vi, beforeEach } from "vitest";
import { corregirPotenciaPartidaInput, corregirPotenciaPartidaCommand } from "@/modules/stock/application/corregir-potencia-partida";
import { ConflictError, DomainError, NotFoundError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/shared/auth/session";

const lockPartidaMock = vi.fn();
const getPartidaParaAccionMock = vi.fn();
const getReservadoEnPreparacionMock = vi.fn();
const updatePotenciaPartidaMock = vi.fn();
const updateActividadPartidaMock = vi.fn();

vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  lockPartidaParaAccion: (...args: unknown[]) => lockPartidaMock(...args),
  getPartidaParaAccion: (...args: unknown[]) => getPartidaParaAccionMock(...args),
  getReservadoEnPreparacion: (...args: unknown[]) => getReservadoEnPreparacionMock(...args),
  updatePotenciaPartida: (...args: unknown[]) => updatePotenciaPartidaMock(...args),
  updateActividadPartida: (...args: unknown[]) => updateActividadPartidaMock(...args),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: vi.fn(async (_tenantId, callback) => {
    return callback({ registroAuditoria: { create: vi.fn() } } as never);
  }),
}));

const VALID_ID = "22222222-2222-4222-a222-222222222222";

function fakeSession(): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "admin@example.com", nombre: "Admin", apellido: "Test" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(["stock.partida.potencia.corregir"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

describe("corregirPotenciaPartidaInput schema validation", () => {
  it("accepts a valid percentage and transforms it into decimal string", () => {
    const result = corregirPotenciaPartidaInput.safeParse({
      id: VALID_ID,
      potenciaDeclaradaNueva: "98.5",
      motivo: "Ajuste de pureza por certificado",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.potenciaDeclaradaNueva).toBe("98.5");
      expect(result.data.motivo).toBe("Ajuste de pureza por certificado");
    }
  });

  it("transforms 100 or 100.0 into null (no correction)", () => {
    const r1 = corregirPotenciaPartidaInput.safeParse({
      id: VALID_ID,
      potenciaDeclaradaNueva: "100",
      motivo: "Sin corrección",
    });
    expect(r1.success).toBe(true);
    if (r1.success) expect(r1.data.potenciaDeclaradaNueva).toBeNull();

    const r2 = corregirPotenciaPartidaInput.safeParse({
      id: VALID_ID,
      potenciaDeclaradaNueva: "100.00",
      motivo: "Sin corrección",
    });
    expect(r2.success).toBe(true);
    if (r2.success) expect(r2.data.potenciaDeclaradaNueva).toBeNull();
  });

  it("transforms empty string or omitted into null", () => {
    const r1 = corregirPotenciaPartidaInput.safeParse({
      id: VALID_ID,
      potenciaDeclaradaNueva: "",
      motivo: "Restablecer a 100%",
    });
    expect(r1.success).toBe(true);
    if (r1.success) expect(r1.data.potenciaDeclaradaNueva).toBeNull();

    const r2 = corregirPotenciaPartidaInput.safeParse({
      id: VALID_ID,
      motivo: "Restablecer a 100%",
    });
    expect(r2.success).toBe(true);
    if (r2.success) expect(r2.data.potenciaDeclaradaNueva).toBeNull();
  });

  it("rejects invalid percentages (<= 0 or > 100 or non-numeric)", () => {
    expect(
      corregirPotenciaPartidaInput.safeParse({
        id: VALID_ID,
        potenciaDeclaradaNueva: "0",
        motivo: "Motivo",
      }).success,
    ).toBe(false);

    expect(
      corregirPotenciaPartidaInput.safeParse({
        id: VALID_ID,
        potenciaDeclaradaNueva: "-5",
        motivo: "Motivo",
      }).success,
    ).toBe(false);

    expect(
      corregirPotenciaPartidaInput.safeParse({
        id: VALID_ID,
        potenciaDeclaradaNueva: "100.5",
        motivo: "Motivo",
      }).success,
    ).toBe(false);

    expect(
      corregirPotenciaPartidaInput.safeParse({
        id: VALID_ID,
        potenciaDeclaradaNueva: "invalido",
        motivo: "Motivo",
      }).success,
    ).toBe(false);
  });

  it("rejects empty or whitespace-only motivo", () => {
    expect(
      corregirPotenciaPartidaInput.safeParse({
        id: VALID_ID,
        potenciaDeclaradaNueva: "95",
        motivo: "   ",
      }).success,
    ).toBe(false);

    expect(
      corregirPotenciaPartidaInput.safeParse({
        id: VALID_ID,
        potenciaDeclaradaNueva: "95",
      }).success,
    ).toBe(false);
  });
});

describe("corregirPotenciaPartidaCommand handler execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockPartidaMock.mockResolvedValue(true);
    getPartidaParaAccionMock.mockResolvedValue({
      id: VALID_ID,
      potenciaDeclarada: "95",
      actividadDeclarada: null,
      cantidadReservada: "0",
    });
    getReservadoEnPreparacionMock.mockResolvedValue({ cantidad: "0", recetas: [] });
    updatePotenciaPartidaMock.mockResolvedValue(true);
    updateActividadPartidaMock.mockResolvedValue(true);
  });

  it("locks, verifies no reservations, updates, and returns output", async () => {
    const res = await corregirPotenciaPartidaCommand.execute(
      { id: VALID_ID, potenciaDeclaradaNueva: "97.5", motivo: "Corrección técnica" },
      { session: fakeSession() },
    );

    expect(lockPartidaMock).toHaveBeenCalled();
    expect(getPartidaParaAccionMock).toHaveBeenCalled();
    expect(getReservadoEnPreparacionMock).toHaveBeenCalled();
    expect(updatePotenciaPartidaMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: VALID_ID,
        potenciaAnterior: "95",
        potenciaNueva: "97.5",
      }),
    );
    expect(res).toEqual({ id: VALID_ID, potenciaDeclarada: "97.5", actividadDeclarada: null });
  });

  it("throws NotFoundError if the partida is not found or not locked", async () => {
    lockPartidaMock.mockResolvedValueOnce(false);
    await expect(
      corregirPotenciaPartidaCommand.execute(
        { id: VALID_ID, potenciaDeclaradaNueva: "97.5", motivo: "Corrección" },
        { session: fakeSession() },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws DomainError if the partida has active reservations", async () => {
    getReservadoEnPreparacionMock.mockResolvedValueOnce({ cantidad: "2.5", recetas: ["101"] });

    await expect(
      corregirPotenciaPartidaCommand.execute(
        { id: VALID_ID, potenciaDeclaradaNueva: "97.5", motivo: "Corrección" },
        { session: fakeSession() },
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("throws ConflictError if updatePotenciaPartida matches 0 rows (concurrent race)", async () => {
    updatePotenciaPartidaMock.mockResolvedValueOnce(false);

    await expect(
      corregirPotenciaPartidaCommand.execute(
        { id: VALID_ID, potenciaDeclaradaNueva: "97.5", motivo: "Corrección" },
        { session: fakeSession() },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("corrects actividadDeclarada for a U.I. lot (accepts X U.I. cada Y g)", async () => {
    getPartidaParaAccionMock.mockResolvedValueOnce({
      id: VALID_ID,
      potenciaDeclarada: null,
      actividadDeclarada: "1000",
      cantidadReservada: "0",
    });

    const res = await corregirPotenciaPartidaCommand.execute(
      { id: VALID_ID, actividadDeclaradaNueva: "1000 U.I. cada 10 g", motivo: "Error de tipeo" },
      { session: fakeSession() },
    );

    expect(updateActividadPartidaMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: VALID_ID,
        actividadAnterior: "1000",
        actividadNueva: "100",
      }),
    );
    expect(res).toEqual({ id: VALID_ID, potenciaDeclarada: null, actividadDeclarada: "100" });
  });

  it("refuses switching a U.I. lot to grams (%) or a gram lot to U.I.", async () => {
    getPartidaParaAccionMock.mockResolvedValueOnce({
      id: VALID_ID,
      potenciaDeclarada: null,
      actividadDeclarada: "1000",
      cantidadReservada: "0",
    });
    await expect(
      corregirPotenciaPartidaCommand.execute(
        { id: VALID_ID, potenciaDeclaradaNueva: "95", motivo: "Cambio" },
        { session: fakeSession() },
      ),
    ).rejects.toBeInstanceOf(DomainError);

    getPartidaParaAccionMock.mockResolvedValueOnce({
      id: VALID_ID,
      potenciaDeclarada: "95",
      actividadDeclarada: null,
      cantidadReservada: "0",
    });
    await expect(
      corregirPotenciaPartidaCommand.execute(
        { id: VALID_ID, actividadDeclaradaNueva: "100", motivo: "Cambio" },
        { session: fakeSession() },
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("refuses correcting actividadDeclarada if the U.I. lot has active reservations", async () => {
    getPartidaParaAccionMock.mockResolvedValueOnce({
      id: VALID_ID,
      potenciaDeclarada: null,
      actividadDeclarada: "1000",
      cantidadReservada: "0",
    });
    getReservadoEnPreparacionMock.mockResolvedValueOnce({ cantidad: "1", recetas: ["202"] });

    await expect(
      corregirPotenciaPartidaCommand.execute(
        { id: VALID_ID, actividadDeclaradaNueva: "100", motivo: "Error de tipeo" },
        { session: fakeSession() },
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
