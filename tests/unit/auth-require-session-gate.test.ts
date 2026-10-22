/**
 * The gate in `requireSession()` (docs/specs/contrasena-temporal.md): a session
 * with pending steps (temporary password, PIN to configure) is rejected with
 * `PasosPendientesError` unless the caller opts out. Cookie reading and session
 * validation are mocked; only the gate is under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthenticationError, PasosPendientesError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/shared/auth/session";

const readSessionCookieMock = vi.fn(async (): Promise<string | null> => "raw-token");
vi.mock("@/modules/auth/infrastructure/cookie-store", () => ({
  readSessionCookie: () => readSessionCookieMock(),
}));

const validateSessionMock = vi.fn(async (...args: unknown[]): Promise<AuthenticatedSession | null> => {
  void args;
  return null;
});
vi.mock("@/modules/auth/application/validate-session", () => ({
  validateSession: (...args: unknown[]) => validateSessionMock(...args),
}));

// `React.cache` memoizes per request scope; tests call the function repeatedly with different sessions.
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));

import { requireSession } from "@/modules/auth/application/require-session";

function sessionWith(pasosPendientes?: AuthenticatedSession["pasosPendientes"]): AuthenticatedSession {
  return {
    usuario: { id: "usuario-1", email: "a@example.com", nombre: "A", apellido: "B" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "sesion-1",
    permisos: new Set() as AuthenticatedSession["permisos"],
    reautenticadaEn: null,
    ...(pasosPendientes ? { pasosPendientes } : {}),
  };
}

beforeEach(() => {
  readSessionCookieMock.mockReset();
  readSessionCookieMock.mockResolvedValue("raw-token");
  validateSessionMock.mockReset();
});

describe("requireSession gate", () => {
  it("CT2: a session that must change its temporary password is rejected with PasosPendientesError", async () => {
    validateSessionMock.mockResolvedValue(sessionWith(["cambiar-password"]));
    const error = await requireSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PasosPendientesError);
    expect((error as PasosPendientesError).paso).toBe("cambiar-password");
  });

  it("CT3: a session that must configure its PIN is rejected with PasosPendientesError", async () => {
    validateSessionMock.mockResolvedValue(sessionWith(["configurar-pin"]));
    const error = await requireSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PasosPendientesError);
    expect((error as PasosPendientesError).paso).toBe("configurar-pin");
  });

  it("reports the FIRST pending step when there are several", async () => {
    validateSessionMock.mockResolvedValue(sessionWith(["cambiar-password", "configurar-pin"]));
    const error = await requireSession().catch((e: unknown) => e);
    expect((error as PasosPendientesError).paso).toBe("cambiar-password");
  });

  it("resolves with the session when the caller opts out of the gate", async () => {
    const pendientePassword = sessionWith(["cambiar-password"]);
    validateSessionMock.mockResolvedValue(pendientePassword);
    await expect(requireSession({ permitirPasosPendientes: true })).resolves.toBe(pendientePassword);

    const pendientePin = sessionWith(["configurar-pin"]);
    validateSessionMock.mockResolvedValue(pendientePin);
    await expect(requireSession({ permitirPasosPendientes: true })).resolves.toBe(pendientePin);
  });

  it("resolves without the option when no step is pending (empty list or field absent)", async () => {
    const vacia = sessionWith([]);
    validateSessionMock.mockResolvedValue(vacia);
    await expect(requireSession()).resolves.toBe(vacia);

    const sinCampo = sessionWith(undefined);
    validateSessionMock.mockResolvedValue(sinCampo);
    await expect(requireSession()).resolves.toBe(sinCampo);
  });

  it("no cookie is still an AuthenticationError, not a pending-step error", async () => {
    readSessionCookieMock.mockResolvedValue(null);
    const error = await requireSession().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error).not.toBeInstanceOf(PasosPendientesError);
    expect(validateSessionMock).not.toHaveBeenCalled();
  });

  it("an invalid session is still an AuthenticationError, also with the opt-out", async () => {
    validateSessionMock.mockResolvedValue(null);
    await expect(requireSession()).rejects.toBeInstanceOf(AuthenticationError);
    await expect(requireSession({ permitirPasosPendientes: true })).rejects.toBeInstanceOf(AuthenticationError);
  });
});
