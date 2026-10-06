/**
 * `darDeBajaEtiquetaTamano` must never leave a tenant without an ACTIVE size
 * (the print dialog would have nothing to offer). The pipeline's edges are
 * mocked like in tests/unit/etiqueta-tamanos-authorization-matrix.test.ts; the
 * repository is mocked too so the handler's own decisions are what is tested.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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

const repo = vi.hoisted(() => ({
  lockEtiquetaTamanosActivos: vi.fn(),
  lockEtiquetaTamano: vi.fn(),
  getEtiquetaTamano: vi.fn(),
  cambiarActivoEtiquetaTamano: vi.fn(),
}));
vi.mock("@/modules/etiqueta-tamanos/infrastructure/etiqueta-tamano-repository", () => repo);

const { darDeBajaEtiquetaTamanoCommand, ULTIMO_ACTIVO_MESSAGE } = await import("@/modules/etiqueta-tamanos/application/dar-de-baja-etiqueta-tamano");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const session: AuthenticatedSession = {
  usuario: { id: "u1", email: "admin@example.com", nombre: "N", apellido: "A" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(["config.editar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

function baja(id: string) {
  return darDeBajaEtiquetaTamanoCommand.execute({ id, motivo: "Ya no se usa" }, { session });
}

describe("darDeBajaEtiquetaTamano -- keeps at least one active size", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.lockEtiquetaTamano.mockResolvedValue(true);
    repo.getEtiquetaTamano.mockImplementation(async (_tx: unknown, _tenant: string, id: string) => ({ id, nombre: "n", anchoMm: 100, altoMm: 42, activo: true }));
  });

  it("rejects the baja of the last active size and updates nothing", async () => {
    repo.lockEtiquetaTamanosActivos.mockResolvedValue([A]);

    const error = await baja(A).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe(ULTIMO_ACTIVO_MESSAGE);
    expect(ULTIMO_ACTIVO_MESSAGE).toBe("Debe quedar al menos un tamaño de etiqueta activo.");
    expect(repo.cambiarActivoEtiquetaTamano).not.toHaveBeenCalled();
  });

  it("allows the baja while another size stays active", async () => {
    repo.lockEtiquetaTamanosActivos.mockResolvedValue([A, B]);

    await expect(baja(A)).resolves.toBeDefined();

    expect(repo.cambiarActivoEtiquetaTamano).toHaveBeenCalledTimes(1);
    expect(repo.cambiarActivoEtiquetaTamano).toHaveBeenCalledWith(expect.anything(), session.tenantId, A, false);
  });

  it("locks the tenant's active sizes BEFORE locking the target row (fixed lock order, no deadlock between two bajas)", async () => {
    repo.lockEtiquetaTamanosActivos.mockResolvedValue([A, B]);
    await baja(A);

    const activos = repo.lockEtiquetaTamanosActivos.mock.invocationCallOrder[0]!;
    const fila = repo.lockEtiquetaTamano.mock.invocationCallOrder[0]!;
    expect(activos).toBeLessThan(fila);
  });

  it("still reports an already-deactivated size as such (not as 'last active')", async () => {
    repo.lockEtiquetaTamanosActivos.mockResolvedValue([B]);
    repo.getEtiquetaTamano.mockResolvedValue({ id: A, nombre: "n", anchoMm: 100, altoMm: 42, activo: false });

    await expect(baja(A)).rejects.toThrow("Este tamaño ya está dado de baja.");
    expect(repo.cambiarActivoEtiquetaTamano).not.toHaveBeenCalled();
  });
});
