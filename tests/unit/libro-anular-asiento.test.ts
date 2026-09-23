/**
 * Unit tests for `modules/libro/application/anular-asiento.ts` (FASE 9, M12
 * point 9.2): happy path, signed-jornada rejection (DP-16c), already-
 * anulado rejection, not-found. Mocks infra/session/transaction, same
 * pattern as tests/unit/stock-co-firma.test.ts.
 *
 * FIX 4 (jd-fix-agent, 2026-09-23): the internal `defineCommand` instance
 * that trusts `autorizadoPorId` is NOT exported anymore (see that module's
 * doc comment) -- these tests go through the public `anularAsiento`
 * wrapper instead, with `verificarCoFirmaDtLibroCommand` mocked at the
 * module boundary. A dedicated test below proves a REJECTED co-firma
 * short-circuits before the asiento is ever locked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError } from "@/shared/errors";

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
    throw new Error("requireSession() unexpectedly called -- inject a session via anularAsiento(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const lockAsientoParaAnularMock = vi.fn();
const getAsientoParaAnularMock = vi.fn();
const insertAnulacionAsientoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "anulacion-1" };
});

vi.mock("@/modules/libro/infrastructure/asiento-repository", () => ({
  lockAsientoParaAnular: (...args: unknown[]) => lockAsientoParaAnularMock(...args),
  getAsientoParaAnular: (...args: unknown[]) => getAsientoParaAnularMock(...args),
  insertAnulacionAsiento: (...args: unknown[]) => insertAnulacionAsientoMock(...args),
}));

/** D2 (2026-09-23): see tests/unit/libro-receta-coupling.test.ts for the repository's own coverage; this file only asserts the CALLER wires it correctly. */
const desvincularRecetaPorAsientoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return null;
});
vi.mock("@/modules/libro/infrastructure/receta-coupling-repository", () => ({
  desvincularRecetaPorAsiento: (...args: unknown[]) => desvincularRecetaPorAsientoMock(...args),
}));

const verificarCoFirmaExecuteMock = vi.fn();
vi.mock("@/modules/libro/application/verificar-co-firma-dt", () => ({
  verificarCoFirmaDtLibroCommand: {
    execute: (...args: unknown[]) => verificarCoFirmaExecuteMock(...args),
  },
}));

const { anularAsiento } = await import("@/modules/libro/application/anular-asiento");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ASIENTO_ID = "33333333-3333-4333-a333-333333333333";
const DT_ID = "22222222-2222-4222-a222-222222222222";

const requesterSession: AuthenticatedSession = {
  usuario: { id: "u-far", email: "far@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["libro.anulacion.solicitar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

function anular(input: { asientoId: string; motivo: string; dtUsuarioId: string; dtPassword: string }) {
  return anularAsiento(input, { session: requesterSession });
}

describe("anularAsiento", () => {
  beforeEach(() => {
    lockAsientoParaAnularMock.mockReset().mockResolvedValue(true);
    getAsientoParaAnularMock.mockReset();
    insertAnulacionAsientoMock.mockClear();
    verificarCoFirmaExecuteMock.mockReset().mockResolvedValue({ ok: true, dtUsuarioId: DT_ID });
    desvincularRecetaPorAsientoMock.mockClear();
  });

  it("happy path: VIGENTE asiento in an unsigned jornada is anulled, autorizadoPorId is the co-firma-verified DT (never trusted otherwise)", async () => {
    getAsientoParaAnularMock.mockResolvedValue({ id: ASIENTO_ID, estado: "VIGENTE", cierreDiarioId: null, numeroCorrelativo: "7" });

    const result = await anular({ asientoId: ASIENTO_ID, motivo: "El paciente no retira", dtUsuarioId: DT_ID, dtPassword: "correcta" });

    expect(result).toEqual({ id: "anulacion-1", asientoId: ASIENTO_ID, numeroCorrelativo: "7" });
    expect(verificarCoFirmaExecuteMock).toHaveBeenCalledWith(
      { dtUsuarioId: DT_ID, password: "correcta" },
      { session: requesterSession },
    );
    expect(insertAnulacionAsientoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, asientoId: ASIENTO_ID, autorizadoPorId: DT_ID, anuladoPorId: "u-far" }),
    );
  });

  it("D2: couples the underlying receta AFTER the anulación insert, passing the asiento's own preparacionId/numeroCorrelativo/motivo -- and the operation still succeeds when the coupling is a no-op (e.g. receta already ENTREGADA)", async () => {
    const PREPARACION_ID = "44444444-4444-4444-a444-444444444444";
    getAsientoParaAnularMock.mockResolvedValue({
      id: ASIENTO_ID,
      estado: "VIGENTE",
      cierreDiarioId: null,
      numeroCorrelativo: "7",
      preparacionId: PREPARACION_ID,
    });
    // Simulates the repository's own "receta already terminal (ENTREGADA)" no-op (see libro-receta-coupling.test.ts).
    desvincularRecetaPorAsientoMock.mockResolvedValue(null);

    const result = await anular({ asientoId: ASIENTO_ID, motivo: "El paciente no retira", dtUsuarioId: DT_ID, dtPassword: "correcta" });

    expect(result).toEqual({ id: "anulacion-1", asientoId: ASIENTO_ID, numeroCorrelativo: "7" });
    expect(desvincularRecetaPorAsientoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        preparacionId: PREPARACION_ID,
        numeroCorrelativo: "7",
        motivo: "El paciente no retira",
        usuarioId: "u-far",
      }),
    );
    // Called AFTER the anulacion_asiento insert (D2: "in the SAME transaction, right after the asiento-side write").
    expect(insertAnulacionAsientoMock.mock.invocationCallOrder[0]!).toBeLessThan(
      desvincularRecetaPorAsientoMock.mock.invocationCallOrder[0]!,
    );
  });

  it("FIX 4: a REJECTED co-firma throws with its exact message, and the asiento is never even locked (no bypass path)", async () => {
    verificarCoFirmaExecuteMock.mockResolvedValue({ ok: false, message: "No se pudo validar la contraseña del Director Técnico." });

    let caught: unknown;
    try {
      await anular({ asientoId: ASIENTO_ID, motivo: "x", dtUsuarioId: DT_ID, dtPassword: "incorrecta" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).message).toBe("No se pudo validar la contraseña del Director Técnico.");
    expect(lockAsientoParaAnularMock).not.toHaveBeenCalled();
    expect(insertAnulacionAsientoMock).not.toHaveBeenCalled();
  });

  it("signed jornada (DP-16c): cierreDiarioId set -> rejects with the exact Spanish message, no INSERT attempted", async () => {
    getAsientoParaAnularMock.mockResolvedValue({ id: ASIENTO_ID, estado: "VIGENTE", cierreDiarioId: "cierre-1", numeroCorrelativo: "7" });

    let caught: unknown;
    try {
      await anular({ asientoId: ASIENTO_ID, motivo: "Error de dato", dtUsuarioId: DT_ID, dtPassword: "correcta" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).message).toBe("La jornada del asiento ya está firmada; corresponde un asiento rectificativo.");
    expect(insertAnulacionAsientoMock).not.toHaveBeenCalled();
  });

  it("already ANULADO: rejects, no INSERT attempted", async () => {
    getAsientoParaAnularMock.mockResolvedValue({ id: ASIENTO_ID, estado: "ANULADO", cierreDiarioId: null, numeroCorrelativo: "7" });

    await expect(anular({ asientoId: ASIENTO_ID, motivo: "x", dtUsuarioId: DT_ID, dtPassword: "correcta" })).rejects.toBeInstanceOf(DomainError);
    expect(insertAnulacionAsientoMock).not.toHaveBeenCalled();
  });

  it("not found: lockAsientoParaAnular returns false -> NotFoundError", async () => {
    lockAsientoParaAnularMock.mockResolvedValue(false);

    await expect(anular({ asientoId: ASIENTO_ID, motivo: "x", dtUsuarioId: DT_ID, dtPassword: "correcta" })).rejects.toBeInstanceOf(NotFoundError);
    expect(getAsientoParaAnularMock).not.toHaveBeenCalled();
  });
});
