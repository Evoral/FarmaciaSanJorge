/**
 * `validateSession` and the enabled verification methods of a cuenta de sector
 * (openspec/changes/metodos-verificacion-operador): the sector carries `metodosHabilitados`, a non-sector session does
 * not, and no query runs while no optional method exists (the per-request hot path).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findSesionCompletaMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
vi.mock("@/modules/auth/infrastructure/session-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/auth/infrastructure/session-repository")>()),
  resolveSessionTenant: vi.fn(async () => "tenant-1"),
  findSesionCompletaByTokenHash: (...args: unknown[]) => findSesionCompletaMock(...args),
  touchSesion: vi.fn(async () => undefined),
}));

const metodosFindMany = vi.fn(async (...args: unknown[]): Promise<unknown[]> => {
  void args;
  return [];
});
const accionesFindMany = vi.fn(async (...args: unknown[]): Promise<unknown[]> => {
  void args;
  return [];
});
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({ metodoVerificacionHabilitado: { findMany: metodosFindMany }, accionConPin: { findMany: accionesFindMany } }),
  ),
}));

import { validateSession } from "@/modules/auth/application/validate-session";
import { METODOS_OPCIONALES, METODOS_SIEMPRE_HABILITADOS } from "@/modules/auth/domain/verificacion-identidad";

const now = new Date("2026-10-22T12:00:00Z");

function completa(esSector: boolean) {
  return {
    sesion: {
      id: "sesion-1",
      tenantId: "tenant-1",
      usuarioId: "u-1",
      creadaEn: now,
      ultimoUsoEn: now,
      expiraEn: new Date("2026-10-23T12:00:00Z"),
      revocadaEn: null,
      reautenticadaEn: null,
    },
    usuario: {
      id: "u-1",
      tenantId: "tenant-1",
      email: "a@b.c",
      nombre: "A",
      apellido: "B",
      permisos: new Set(),
      estado: "ACTIVO",
      debeCambiarPassword: false,
      tienePin: true,
      esSector,
      esTecnico: false,
      soloAdministrador: false,
    },
    tenantFechaBaja: null,
    tenantEstado: "ACTIVO",
  };
}

beforeEach(() => {
  findSesionCompletaMock.mockReset();
  metodosFindMany.mockClear();
  accionesFindMany.mockClear();
});

describe("validateSession: metodosHabilitados", () => {
  it("a sector session carries the enabled methods, seeded with the always-on ones", async () => {
    findSesionCompletaMock.mockResolvedValue(completa(true));
    const session = await validateSession("raw-token", now);
    expect([...(session?.sector?.metodosHabilitados ?? [])]).toEqual([...METODOS_SIEMPRE_HABILITADOS]);
    expect(session?.sector?.permisosConPin).toBeDefined();
  });

  it("a non-sector session has no sector block and loads neither set", async () => {
    findSesionCompletaMock.mockResolvedValue(completa(false));
    const session = await validateSession("raw-token", now);
    expect(session?.sector).toBeNull();
    expect(accionesFindMany).not.toHaveBeenCalled();
    expect(metodosFindMany).not.toHaveBeenCalled();
  });

  it("runs no methods query while no optional method exists", async () => {
    expect(METODOS_OPCIONALES).toHaveLength(0);
    findSesionCompletaMock.mockResolvedValue(completa(true));
    await validateSession("raw-token", now);
    expect(accionesFindMany).toHaveBeenCalledTimes(1);
    expect(metodosFindMany).not.toHaveBeenCalled();
  });
});
