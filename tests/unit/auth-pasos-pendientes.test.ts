/**
 * Pending steps on the session (docs/specs/contrasena-temporal.md): the pure
 * derivation, the route mapping, the error type, and that `validateSession`
 * carries the result on the session it builds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveSessionTenantMock = vi.fn(async (...args: unknown[]): Promise<string | null> => {
  void args;
  return "tenant-1";
});
const findSesionCompletaMock = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  return null;
});
vi.mock("@/modules/auth/infrastructure/session-repository", () => ({
  resolveSessionTenant: (...args: unknown[]) => resolveSessionTenantMock(...args),
  findSesionCompletaByTokenHash: (...args: unknown[]) => findSesionCompletaMock(...args),
  loadPermisosConPin: vi.fn(async () => new Set()),
  touchSesion: vi.fn(async () => undefined),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true })),
}));

import { derivarPasosPendientes } from "@/modules/auth/domain/pasos-pendientes";
import { rutaDelPaso } from "@/shared/auth/pasos";
import { PasosPendientesError, userMessageFor } from "@/shared/errors";
import { validateSession } from "@/modules/auth/application/validate-session";

const base = { debeCambiarPassword: false, tienePin: false, esSector: false, esTecnico: false };

describe("derivarPasosPendientes", () => {
  it("asks to change the temporary password first, whether or not there is a PIN", () => {
    expect(derivarPasosPendientes({ ...base, debeCambiarPassword: true })).toEqual(["cambiar-password"]);
    expect(derivarPasosPendientes({ ...base, debeCambiarPassword: true, tienePin: true })).toEqual(["cambiar-password"]);
  });

  it("asks to configure the PIN only once the password is settled", () => {
    expect(derivarPasosPendientes(base)).toEqual(["configurar-pin"]);
  });

  it("has nothing pending when the PIN exists and the password is not temporary", () => {
    expect(derivarPasosPendientes({ ...base, tienePin: true })).toEqual([]);
  });

  it("CT6: a cuenta de sector never has a PIN step, but still must change a temporary password", () => {
    expect(derivarPasosPendientes({ ...base, esSector: true })).toEqual([]);
    expect(derivarPasosPendientes({ ...base, esSector: true, debeCambiarPassword: true })).toEqual(["cambiar-password"]);
  });

  it("the technical SISTEMA user has no PIN step", () => {
    expect(derivarPasosPendientes({ ...base, esTecnico: true })).toEqual([]);
  });
});

describe("rutaDelPaso", () => {
  it("maps each step to its page", () => {
    expect(rutaDelPaso("cambiar-password")).toBe("/cambiar-password");
    expect(rutaDelPaso("configurar-pin")).toBe("/configurar-pin");
  });
});

describe("PasosPendientesError", () => {
  it("carries the code, the step and a Spanish user message", () => {
    const err = new PasosPendientesError("configurar-pin");
    expect(err.code).toBe("PASOS_PENDIENTES");
    expect(err.paso).toBe("configurar-pin");
    expect(userMessageFor(err, "x")).toBe("Antes de seguir tenés que configurar tu PIN.");
    expect(userMessageFor(new PasosPendientesError("cambiar-password"), "x")).toBe(
      "Antes de seguir tenés que cambiar tu contraseña temporal.",
    );
  });
});

describe("validateSession pasosPendientes", () => {
  const now = new Date("2026-10-22T12:00:00Z");

  function completa(usuario: Record<string, unknown>) {
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
      usuario: { id: "u-1", tenantId: "tenant-1", email: "a@b.c", nombre: "A", apellido: "B", permisos: new Set(), ...usuario },
      tenantFechaBaja: null,
    };
  }

  beforeEach(() => {
    findSesionCompletaMock.mockReset();
  });

  it("CT6: a cuenta de sector without PIN has no pending steps", async () => {
    findSesionCompletaMock.mockResolvedValue(
      completa({ estado: "ACTIVO", debeCambiarPassword: false, tienePin: false, esSector: true, esTecnico: false }),
    );
    const session = await validateSession("raw-token", now);
    expect(session?.pasosPendientes).toEqual([]);
  });

  it("an individual usuario without PIN must configure it", async () => {
    findSesionCompletaMock.mockResolvedValue(
      completa({ estado: "ACTIVO", debeCambiarPassword: false, tienePin: false, esSector: false, esTecnico: false }),
    );
    const session = await validateSession("raw-token", now);
    expect(session?.pasosPendientes).toEqual(["configurar-pin"]);
  });
});
