/**
 * Unit tests for FASE 12 point 12.1 (`modules/archivo/application/conformar-lote.ts`):
 * the post-lock eligibility re-check. `lockRecetasParaArchivo` only proves
 * the candidate rows still EXIST, not that a concurrent transaction didn't
 * already commit one of them to a DIFFERENT lote right before the lock --
 * `recheckRecetasElegibles` closes that gap. Same mocking shape as
 * tests/unit/archivo-destruccion-flows.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError } from "@/shared/errors";

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
}));

const RECETA_IDS = ["11111111-1111-4111-a111-111111111111", "22222222-2222-4222-a222-222222222222"];

const listRecetasElegiblesMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return RECETA_IDS.map((id, i) => ({ id, numeroInterno: String(i + 1), pacienteNombre: "N", pacienteApellido: "A", estado: "ENTREGADA" as const, fechaIngreso: "2024-06-15" }));
});
const lockRecetasParaArchivoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return RECETA_IDS.length;
});
const recheckRecetasElegiblesMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return RECETA_IDS;
});
const derivarIncluyeControladasMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const insertLoteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "lote-1", numero: "1" };
});
const asignarRecetasALoteMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});

vi.mock("@/modules/archivo/infrastructure/archivo-repository", () => ({
  listRecetasElegibles: (...args: unknown[]) => listRecetasElegiblesMock(...args),
  lockRecetasParaArchivo: (...args: unknown[]) => lockRecetasParaArchivoMock(...args),
  recheckRecetasElegibles: (...args: unknown[]) => recheckRecetasElegiblesMock(...args),
  derivarIncluyeControladas: (...args: unknown[]) => derivarIncluyeControladasMock(...args),
  insertLote: (...args: unknown[]) => insertLoteMock(...args),
  asignarRecetasALote: (...args: unknown[]) => asignarRecetasALoteMock(...args),
}));

const { conformarLoteCommand } = await import("@/modules/archivo/application/conformar-lote");

const TENANT_ID = "33333333-3333-4333-a333-333333333333";
const DT_USUARIO_ID = "u-dt";

const dtSession: AuthenticatedSession = {
  usuario: { id: DT_USUARIO_ID, email: "dt@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["archivo.lotes.gestionar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

const VALID_INPUT = { periodoDesde: "2024-06-01", periodoHasta: "2024-06-30", ubicacion: "Deposito A" };

beforeEach(() => {
  listRecetasElegiblesMock.mockClear();
  lockRecetasParaArchivoMock.mockReset().mockResolvedValue(RECETA_IDS.length);
  recheckRecetasElegiblesMock.mockReset().mockResolvedValue(RECETA_IDS);
  derivarIncluyeControladasMock.mockClear();
  insertLoteMock.mockClear();
  asignarRecetasALoteMock.mockClear();
});

describe("conformarLoteCommand -- post-lock re-check", () => {
  it("creates the lote when every locked receta is still eligible", async () => {
    const output = await conformarLoteCommand.execute(VALID_INPUT, { session: dtSession });

    expect(output.id).toBe("lote-1");
    expect(recheckRecetasElegiblesMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, RECETA_IDS);
    expect(insertLoteMock).toHaveBeenCalledTimes(1);
    expect(asignarRecetasALoteMock).toHaveBeenCalledTimes(1);
  });

  it("rejects with a clear Spanish message when a locked receta is no longer eligible (already assigned to another lote)", async () => {
    // One of the two recetas was committed to a different lote by a
    // concurrent transaction between the initial read and the lock --
    // recheck only finds ONE of the two still eligible.
    recheckRecetasElegiblesMock.mockResolvedValue([RECETA_IDS[0]]);

    await expect(conformarLoteCommand.execute(VALID_INPUT, { session: dtSession })).rejects.toThrow(
      "Algunas recetas ya fueron asignadas a otro lote; vuelva a generar la propuesta.",
    );
    await expect(conformarLoteCommand.execute(VALID_INPUT, { session: dtSession })).rejects.toBeInstanceOf(DomainError);

    expect(insertLoteMock).not.toHaveBeenCalled();
    expect(asignarRecetasALoteMock).not.toHaveBeenCalled();
  });

  it("rejects when NO locked receta is still eligible", async () => {
    recheckRecetasElegiblesMock.mockResolvedValue([]);

    await expect(conformarLoteCommand.execute(VALID_INPUT, { session: dtSession })).rejects.toBeInstanceOf(DomainError);
    expect(insertLoteMock).not.toHaveBeenCalled();
  });
});
