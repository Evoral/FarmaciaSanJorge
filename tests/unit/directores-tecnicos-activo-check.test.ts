/**
 * FASE 3 point 3.9 review finding M1: unit regression test for
 * `designarDirectorTecnico`'s app-level ACTIVO pre-check (a fresh read
 * inside the transaction, not the picker's stale list -- see that file's
 * module doc comment). The real guarantee is the DB's INV-DT-005 trigger
 * (migration 0022, prisma/migrations/20260921100200_0022_dt_usuario_activo);
 * that side is covered by tests/db/designacion-dt.test.ts. This is a
 * stubbed-tx unit test in the same style as
 * tests/unit/usuarios-crear-usuario-audit.test.ts: the repository
 * (`getUsuarioEstado`/`insertDesignacion`) is mocked so the handler runs
 * with no real database at all -- what this proves is that the handler
 * actually performs the check, in the right order, with the right message,
 * BEFORE ever calling insertDesignacion.
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
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const getUsuarioEstadoMock = vi.fn(async (...args: unknown[]): Promise<string | null> => {
  void args;
  return "ACTIVO";
});
const insertDesignacionMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "designacion-1" };
});
vi.mock("@/modules/directores-tecnicos/infrastructure/designacion-repository", () => ({
  getUsuarioEstado: (...args: unknown[]) => getUsuarioEstadoMock(...args),
  insertDesignacion: (...args: unknown[]) => insertDesignacionMock(...args),
}));

const { designarDirectorTecnicoCommand } = await import("@/modules/directores-tecnicos/application/designar-director-tecnico");

function fakeSession(): AuthenticatedSession {
  return {
    usuario: { id: "admin-1", email: "admin@example.com", nombre: "A", apellido: "D" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(["dt.designar"]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const BASE_INPUT = {
  usuarioId: "22222222-2222-4222-a222-222222222222",
  caracter: "TITULAR" as const,
  matricula: "MAT-1",
  vigenteDesde: "2026-01-01",
};

beforeEach(() => {
  getUsuarioEstadoMock.mockReset();
  insertDesignacionMock.mockClear();
});

describe("M1: designarDirectorTecnico's app-level ACTIVO pre-check", () => {
  it("ACTIVO usuario: the designation proceeds (insertDesignacion is called)", async () => {
    getUsuarioEstadoMock.mockResolvedValue("ACTIVO");

    const result = await designarDirectorTecnicoCommand.execute(BASE_INPUT, { session: fakeSession() });

    expect(result).toEqual({ designacionId: "designacion-1" });
    expect(insertDesignacionMock).toHaveBeenCalledTimes(1);
  });

  it("SUSPENDIDO usuario: rejected with a DomainError (Spanish message), insertDesignacion never called", async () => {
    getUsuarioEstadoMock.mockResolvedValue("SUSPENDIDO");

    let caught: unknown;
    try {
      await designarDirectorTecnicoCommand.execute(BASE_INPUT, { session: fakeSession() });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).message).toMatch(/ACTIVO/);
    expect(insertDesignacionMock).not.toHaveBeenCalled();
  });

  it.each(["PENDIENTE_ACTIVACION", "BAJA"])("%s usuario: also rejected with a DomainError", async (estado) => {
    getUsuarioEstadoMock.mockResolvedValue(estado);

    let caught: unknown;
    try {
      await designarDirectorTecnicoCommand.execute(BASE_INPUT, { session: fakeSession() });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect(insertDesignacionMock).not.toHaveBeenCalled();
  });

  it("usuario not found (getUsuarioEstado returns null): rejected with NotFoundError, insertDesignacion never called", async () => {
    getUsuarioEstadoMock.mockResolvedValue(null);

    let caught: unknown;
    try {
      await designarDirectorTecnicoCommand.execute(BASE_INPUT, { session: fakeSession() });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NotFoundError);
    expect(insertDesignacionMock).not.toHaveBeenCalled();
  });
});
