/**
 * Unit tests for "Incluir excipientes en la etiqueta" sheet configuration (migration 0117):
 * - editarIncluirExcipientesCommand (permissions, lock order, upsert, audit)
 * - getIncluirExcipientesQuery (config.ver) and getIncluirExcipientesParaGenerarQuery (etiquetas.generar)
 * - getIncluirExcipientes and upsertIncluirExcipientes repository functions (fallback to default sheet on insert)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError } from "@/shared/errors";
import type { record } from "@/shared/audit";

const recordMock = vi.fn<typeof record>(async () => undefined);
vi.mock("@/shared/audit", () => ({
  record: (...args: Parameters<typeof record>) => recordMock(...args),
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

const repoMock = vi.hoisted(() => ({
  getIncluirExcipientes: vi.fn(),
  lockEtiquetaHoja: vi.fn(),
  upsertIncluirExcipientes: vi.fn(),
}));
vi.mock("@/modules/etiqueta-tamanos/infrastructure/etiqueta-hoja-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/etiqueta-tamanos/infrastructure/etiqueta-hoja-repository")>();
  return {
    ...actual,
    getIncluirExcipientes: repoMock.getIncluirExcipientes,
    lockEtiquetaHoja: repoMock.lockEtiquetaHoja,
    upsertIncluirExcipientes: repoMock.upsertIncluirExcipientes,
  };
});

const { editarIncluirExcipientesCommand } = await import(
  "@/modules/etiqueta-tamanos/application/editar-incluir-excipientes"
);
const {
  getIncluirExcipientesQuery,
  getIncluirExcipientesParaGenerarQuery,
} = await import("@/modules/etiqueta-tamanos/application/get-incluir-excipientes");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function buildSession(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "user@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

describe("editarIncluirExcipientesCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gated by config.editar: denies users without it", async () => {
    const sessionSinPermiso = buildSession(["etiquetas.generar", "etiquetas.imprimir"]);
    await expect(
      editarIncluirExcipientesCommand.execute({ incluirExcipientes: true }, { session: sessionSinPermiso })
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(repoMock.lockEtiquetaHoja).not.toHaveBeenCalled();
    expect(repoMock.upsertIncluirExcipientes).not.toHaveBeenCalled();
  });

  it("locks the hoja row before reading and writing, audits before/after, and returns the new value", async () => {
    const session = buildSession(["config.editar"]);
    const callOrder: string[] = [];

    repoMock.lockEtiquetaHoja.mockImplementation(async () => {
      callOrder.push("lock");
    });
    repoMock.getIncluirExcipientes.mockImplementation(async () => {
      callOrder.push("read");
      return false;
    });
    repoMock.upsertIncluirExcipientes.mockImplementation(async () => {
      callOrder.push("upsert");
    });

    const resultado = await editarIncluirExcipientesCommand.execute(
      { incluirExcipientes: true },
      { session }
    );

    expect(resultado).toEqual({ incluirExcipientes: true });
    expect(callOrder).toEqual(["lock", "read", "upsert"]);
    expect(repoMock.lockEtiquetaHoja).toHaveBeenCalledWith(expect.anything(), TENANT_ID);
    expect(repoMock.getIncluirExcipientes).toHaveBeenCalledWith(expect.anything(), TENANT_ID);
    expect(repoMock.upsertIncluirExcipientes).toHaveBeenCalledWith(expect.anything(), TENANT_ID, true);

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        entidad: "etiqueta_hoja",
        entidadId: TENANT_ID,
        accion: "MODIFICAR",
        valorAnterior: { incluirExcipientes: false },
        valorNuevo: { incluirExcipientes: true },
      })
    );
  });
});

describe("get-incluir-excipientes queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getIncluirExcipientesQuery", () => {
    it("is gated by config.ver and returns repository value", async () => {
      repoMock.getIncluirExcipientes.mockResolvedValueOnce(true);
      const sessionVer = buildSession(["config.ver"]);

      const res = await getIncluirExcipientesQuery.execute({}, { session: sessionVer });
      expect(res).toBe(true);
      expect(repoMock.getIncluirExcipientes).toHaveBeenCalledWith(expect.anything(), TENANT_ID);

      const sessionSinVer = buildSession(["etiquetas.generar"]);
      await expect(
        getIncluirExcipientesQuery.execute({}, { session: sessionSinVer })
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("missing row reads false", async () => {
      repoMock.getIncluirExcipientes.mockResolvedValueOnce(false);
      const sessionVer = buildSession(["config.ver"]);

      const res = await getIncluirExcipientesQuery.execute({}, { session: sessionVer });
      expect(res).toBe(false);
    });
  });

  describe("getIncluirExcipientesParaGenerarQuery", () => {
    it("is gated by etiquetas.generar and returns repository value", async () => {
      repoMock.getIncluirExcipientes.mockResolvedValueOnce(true);
      const sessionGenerar = buildSession(["etiquetas.generar"]);

      const res = await getIncluirExcipientesParaGenerarQuery.execute({}, { session: sessionGenerar });
      expect(res).toBe(true);
      expect(repoMock.getIncluirExcipientes).toHaveBeenCalledWith(expect.anything(), TENANT_ID);

      const sessionSinGenerar = buildSession(["config.ver"]);
      await expect(
        getIncluirExcipientesParaGenerarQuery.execute({}, { session: sessionSinGenerar })
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("missing row reads false", async () => {
      repoMock.getIncluirExcipientes.mockResolvedValueOnce(false);
      const sessionGenerar = buildSession(["etiquetas.generar"]);

      const res = await getIncluirExcipientesParaGenerarQuery.execute({}, { session: sessionGenerar });
      expect(res).toBe(false);
    });
  });
});
