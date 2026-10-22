/**
 * Unit tests for `modules/auth/application/cambiar-password-temporal.ts`
 * (docs/specs/contrasena-temporal.md, step 1): everything I/O is mocked,
 * same style as tests/unit/auth-reauth-pin.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError } from "@/shared/errors";

const recordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => recordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => session),
  requireRecentReauth: vi.fn(),
}));

const verifyPasswordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return false;
});
const hashPasswordMock = vi.fn(async (plain: string) => `hashed:${plain.length}`);
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
  hashPassword: (plain: string) => hashPasswordMock(plain),
}));

const loadUsuarioParaPasswordMock = vi.fn();
const completarCambioPasswordTemporalMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadUsuarioParaPassword: (...args: unknown[]) => loadUsuarioParaPasswordMock(...args),
  completarCambioPasswordTemporal: (...args: unknown[]) => completarCambioPasswordTemporalMock(...args),
}));

const revokeOtherSesionesForUsuarioMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return 3;
});
vi.mock("@/modules/auth/infrastructure/session-repository", () => ({
  revokeOtherSesionesForUsuario: (...args: unknown[]) => revokeOtherSesionesForUsuarioMock(...args),
}));

const { cambiarPasswordTemporalCommand } = await import("@/modules/auth/application/cambiar-password-temporal");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-2222-2222-222222222222";
const SESION_ID = "s1";
const NUEVA = "Nueva-Segura-2026!x";

const session: AuthenticatedSession = {
  usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: SESION_ID,
  permisos: new Set(["auth.password.cambiar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: null,
};

function execute(input: { nueva: string; nuevaRepeat: string }) {
  return cambiarPasswordTemporalCommand.execute(input, { session });
}

function usuarioRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USUARIO_ID,
    email: "u@example.com",
    passwordHash: "temp-hash",
    pinHash: null,
    debeCambiarPassword: true,
    esSector: false,
    ...overrides,
  };
}

beforeEach(() => {
  recordMock.mockClear();
  verifyPasswordMock.mockReset().mockResolvedValue(false);
  hashPasswordMock.mockClear();
  loadUsuarioParaPasswordMock.mockReset().mockResolvedValue(usuarioRow());
  completarCambioPasswordTemporalMock.mockClear();
  revokeOtherSesionesForUsuarioMock.mockClear();
});

describe("cambiarPasswordTemporal", () => {
  it("changes the password, clears the flag, revokes other sessions and audits MODIFICAR with the exact motivo", async () => {
    const result = await execute({ nueva: NUEVA, nuevaRepeat: NUEVA });

    expect(result).toEqual({ sesionesRevocadas: 3 });
    expect(completarCambioPasswordTemporalMock).toHaveBeenCalledTimes(1);
    const [, usuarioId, hash] = completarCambioPasswordTemporalMock.mock.calls[0]!;
    expect(usuarioId).toBe(USUARIO_ID);
    expect(typeof hash).toBe("string");
    expect(hash).not.toBe(NUEVA);

    expect(revokeOtherSesionesForUsuarioMock).toHaveBeenCalledTimes(1);
    expect(revokeOtherSesionesForUsuarioMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, USUARIO_ID, SESION_ID, expect.any(Date));

    expect(recordMock).toHaveBeenCalledTimes(1);
    const auditArgs = recordMock.mock.calls[0]!;
    expect(JSON.stringify(auditArgs)).toContain("Cambio de contraseña temporal por el propio usuario.");
    expect(JSON.stringify(auditArgs)).toContain("MODIFICAR");
    expect(JSON.stringify(auditArgs)).toContain(USUARIO_ID);
    // Never the plaintext nor the hash in the audit row.
    expect(JSON.stringify(auditArgs)).not.toContain(NUEVA);
    expect(JSON.stringify(auditArgs)).not.toContain(String(hash));
  });

  it("rejects when the usuario has no pending change", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue(usuarioRow({ debeCambiarPassword: false }));

    const error = await execute({ nueva: NUEVA, nuevaRepeat: NUEVA }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("No tenés un cambio de contraseña pendiente. Si querés cambiarla, hacelo desde «Mi cuenta».");
    expect(completarCambioPasswordTemporalMock).not.toHaveBeenCalled();
    expect(revokeOtherSesionesForUsuarioMock).not.toHaveBeenCalled();
  });

  it("rejects when the usuario row is missing", async () => {
    loadUsuarioParaPasswordMock.mockResolvedValue(null);

    await expect(execute({ nueva: NUEVA, nuevaRepeat: NUEVA })).rejects.toThrow("No se pudo actualizar la contraseña.");
    expect(completarCambioPasswordTemporalMock).not.toHaveBeenCalled();
  });

  it("rejects a new password equal to the temporary one", async () => {
    verifyPasswordMock.mockResolvedValue(true);

    const error = await execute({ nueva: NUEVA, nuevaRepeat: NUEVA }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe("La nueva contraseña tiene que ser distinta de la temporal.");
    expect((error as DomainError).fields).toEqual(["nueva"]);
    expect(verifyPasswordMock).toHaveBeenCalledWith("temp-hash", NUEVA);
    expect(completarCambioPasswordTemporalMock).not.toHaveBeenCalled();
    expect(revokeOtherSesionesForUsuarioMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched repeats (field nuevaRepeat) and policy violations (field nueva)", async () => {
    const mismatch = await execute({ nueva: NUEVA, nuevaRepeat: `${NUEVA}-otra` }).catch((e: unknown) => e);
    expect(mismatch).toBeInstanceOf(Error);
    expect((mismatch as { fields?: string[] }).fields).toContain("nuevaRepeat");

    const weak = await execute({ nueva: "corta", nuevaRepeat: "corta" }).catch((e: unknown) => e);
    expect(weak).toBeInstanceOf(Error);
    expect((weak as { fields?: string[] }).fields).toContain("nueva");

    expect(completarCambioPasswordTemporalMock).not.toHaveBeenCalled();
  });
});

describe("CT4: only completarCambioPasswordTemporal clears debeCambiarPassword", () => {
  /**
   * Files allowed to contain the literal `debeCambiarPassword: false` in
   * `modules/**`. The clearing write lives in the auth repository, and
   * nowhere else may set the flag to false. Keep this list explicit: adding
   * an entry must be a conscious, reviewed decision (a read-side WHERE
   * filter is fine, a write is not).
   *
   * - usuario-repository.ts: the clearing write itself.
   * - operadores-repository.ts: a WHERE read filter in `listOperadores`
   *   (cannot clear the flag).
   */
  const ALLOWED_FILES = ["modules/auth/infrastructure/usuario-repository.ts", "modules/operadores/infrastructure/operadores-repository.ts"];
  const NEEDLE = "debeCambiarPassword: false";

  function walk(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("the literal appears in modules/** source only in the allowlisted files", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const file of walk(join(root, "modules"), [])) {
      const rel = relative(root, file).split(sep).join("/");
      if (readFileSync(file, "utf8").includes(NEEDLE)) {
        seen.add(rel);
        if (!ALLOWED_FILES.includes(rel)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
    // The allowlist must not go stale: the clearing write really exists there.
    expect([...seen].sort()).toEqual([...ALLOWED_FILES].sort());
  });
});
