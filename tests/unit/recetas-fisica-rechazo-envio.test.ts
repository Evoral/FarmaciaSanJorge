/**
 * FASE 11 / DP-34 decision 1 (2026-09-24): the standalone 6.4
 * (`registrarRecepcionFisica`) must be rejected while the receta is
 * ENVIADA_PEND_FIRMA -- see modules/recetas/application/registrar-recepcion-fisica.ts's
 * doc comment. Mocked repository/tx, no DB (migration 0040's INV-ENT-003
 * covers the DB-level backstop, tests/db).
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError } from "@/shared/errors";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const RECETA_ID = "22222222-2222-4222-a222-222222222222";

const lockRecetaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return true;
});
const getRecetaParaAccionMock = vi.fn();
const registrarRecepcionFisicaRepoMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});

vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  lockRecetaParaAccion: (...args: unknown[]) => lockRecetaMock(...args),
  getRecetaParaAccion: (...args: unknown[]) => getRecetaParaAccionMock(...args),
  registrarRecepcionFisica: (...args: unknown[]) => registrarRecepcionFisicaRepoMock(...args),
}));

const { registrarRecepcionFisicaCommand } = await import("@/modules/recetas/application/registrar-recepcion-fisica");

function fakeSession(): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(["recetas.fisica.registrar"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

describe("registrarRecepcionFisica -- rejected while ENVIADA_PEND_FIRMA (use confirmarFirmaRecibida instead)", () => {
  it("throws DomainError and never calls the repo write", async () => {
    getRecetaParaAccionMock.mockResolvedValue({
      id: RECETA_ID,
      pacienteId: "p",
      medicoId: "m",
      fechaPrescripcion: new Date(),
      origen: "PRESENCIAL",
      estado: "ENVIADA_PEND_FIRMA",
      recetaFisicaRecibida: false,
      motivoAnulacion: null,
    });

    await expect(registrarRecepcionFisicaCommand.execute({ id: RECETA_ID }, { session: fakeSession() })).rejects.toBeInstanceOf(DomainError);
    expect(registrarRecepcionFisicaRepoMock).not.toHaveBeenCalled();
  });

  it("still works normally for any OTHER non-terminal estado", async () => {
    getRecetaParaAccionMock.mockResolvedValue({
      id: RECETA_ID,
      pacienteId: "p",
      medicoId: "m",
      fechaPrescripcion: new Date(),
      origen: "PRESENCIAL",
      estado: "PREPARADA",
      recetaFisicaRecibida: false,
      motivoAnulacion: null,
    });

    await registrarRecepcionFisicaCommand.execute({ id: RECETA_ID }, { session: fakeSession() });
    expect(registrarRecepcionFisicaRepoMock).toHaveBeenCalledTimes(1);
  });
});
