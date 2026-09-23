/**
 * Business-rule tests for modules/usuarios/application/*.ts (FASE 3, points
 * 3.1-3.8): input validation (zod) and the M2 step-up regression below.
 *
 * The GENERIC "every use case in the codebase registers itself and rejects
 * a permissionless session before touching a transaction" guarantee this
 * file used to assert (via a hand-maintained 11-entry import list) now
 * lives in tests/unit/usecase-registry-all-modules.test.ts (N3, security
 * review): that file globs EVERY modules/*\/application/**\/*.ts file
 * automatically, so a use case added anywhere in the app -- not just this
 * module -- is covered without anyone remembering to update a list here.
 * This file keeps importing the usuarios application modules directly
 * because the tests below assert USUARIOS-SPECIFIC business rules, not the
 * generic registry guarantee.
 *
 * DB/audit/session are mocked exactly like tests/unit/usecase.test.ts --
 * these tests prove PIPELINE WIRING (authorize -> zod -> tx) and specific
 * handler-level rules, not DB behavior (that is tests/db/*). ONE exception:
 * `requireRecentReauth` below is NOT a no-op -- it delegates to the REAL
 * `modules/auth/domain/step-up.ts` policy (a pure function, no I/O) so the
 * M2 regression test can actually observe `StepUpRequiredError` instead of
 * having step-up silently short-circuited.
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ValidationError, StepUpRequiredError } from "@/shared/errors";
import { requireRecentReauth as realRequireRecentReauth } from "@/modules/auth/domain/step-up";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

let lastFakeTx: unknown;
const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => {
  lastFakeTx = { __fakeTx: true, tenantId };
  return fn(lastFakeTx);
});
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

const requireSessionMock = vi.fn(async (): Promise<AuthenticatedSession> => {
  throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
});
vi.mock("@/shared/auth/session", () => ({
  requireSession: () => requireSessionMock(),
  // Real step-up policy (modules/auth/domain/step-up.ts is pure -- no
  // next/headers, no Prisma -- so this needs no extra mocking). See the
  // module doc comment above: this is what M2's regression test below
  // relies on.
  requireRecentReauth: (session: AuthenticatedSession, maxAgeMinutes: number, now?: Date) =>
    realRequireRecentReauth(session, maxAgeMinutes, now),
}));

// Imported AFTER the mocks above (vi.mock is hoisted). Side-effect imports:
// each module registers its command/query with shared/usecase.ts at import time.
await import("@/modules/usuarios/application/list-usuarios");
await import("@/modules/usuarios/application/get-usuario");
await import("@/modules/usuarios/application/list-usuario-auditoria");
await import("@/modules/usuarios/application/crear-usuario");
await import("@/modules/usuarios/application/editar-usuario");
await import("@/modules/usuarios/application/cambiar-roles");
await import("@/modules/usuarios/application/suspender-usuario");
await import("@/modules/usuarios/application/reactivar-usuario");
await import("@/modules/usuarios/application/dar-de-baja-usuario");
await import("@/modules/usuarios/application/restablecer-credencial");
await import("@/modules/usuarios/application/list-roles-con-permisos");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

function fakeSession(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "usuario-1", email: "a@example.com", nombre: "A", apellido: "B" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "sesion-1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

// The generic "registers itself" / "rejects a permissionless session for
// EVERY registered use case" assertions that used to live here now live in
// tests/unit/usecase-registry-all-modules.test.ts (N3) -- see this file's
// module doc comment above.

describe("input validation runs after authorize() but before any transaction is opened", () => {
  it("crearUsuario rejects an empty roles array", async () => {
    withTenantTransactionMock.mockClear();
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.crear")!;
    await expect(
      entry.execute(
        { nombre: "A", apellido: "B", email: "a@b.com", dni: "1", roles: [] },
        { session: fakeSession(["usuarios.crear"]) },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
  });

  it("crearUsuario rejects SISTEMA as a role (structurally impossible -- not in the zod enum)", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.crear")!;
    await expect(
      entry.execute(
        { nombre: "A", apellido: "B", email: "a@b.com", dni: "1", roles: ["SISTEMA"] },
        { session: fakeSession(["usuarios.crear"]) },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("crearUsuario rejects an invalid email", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.crear")!;
    await expect(
      entry.execute(
        { nombre: "A", apellido: "B", email: "not-an-email", dni: "1", roles: ["FARMACEUTICO"] },
        { session: fakeSession(["usuarios.crear"]) },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("suspenderUsuario rejects a missing/empty motivo", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.suspender")!;
    await expect(
      entry.execute({ usuarioId: "11111111-1111-1111-1111-111111111111", motivo: "" }, { session: fakeSession(["usuarios.suspender"]) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("darDeBajaUsuario rejects a missing motivo", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.baja")!;
    await expect(
      entry.execute({ usuarioId: "11111111-1111-1111-1111-111111111111" }, { session: fakeSession(["usuarios.baja"]) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("cambiarRoles rejects an empty roles array (would leave the user with zero roles -- INV-U02 first line of defense)", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.roles.modificar")!;
    await expect(
      entry.execute(
        { usuarioId: "11111111-1111-1111-1111-111111111111", roles: [] },
        { session: fakeSession(["usuarios.roles.modificar"]) },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("listUsuarios rejects an unknown estado filter value", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.listar")!;
    await expect(entry.execute({ estado: "NO_EXISTE" }, { session: fakeSession(["usuarios.listar"]) })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("M2 (security review): crearUsuario requires a recent re-authentication, same as the other sensitive usuarios commands", () => {
  it("raises StepUpRequiredError when the session has never re-authenticated (reautenticadaEn: null)", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.crear")!;
    const session: AuthenticatedSession = { ...fakeSession(["usuarios.crear"]), reautenticadaEn: null };

    await expect(
      entry.execute(
        { nombre: "A", apellido: "B", email: "a@b.com", dni: "1", roles: ["FARMACEUTICO"] },
        { session },
      ),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
    // requireRecentReauth (shared/usecase.ts pipeline) runs BEFORE zod.parse
    // and BEFORE opening a transaction -- confirms this isn't accidentally
    // passing because of an unrelated validation failure.
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
  });

  it("raises StepUpRequiredError when the last re-authentication is older than AUTH_POLICY.reauthWindowMinutes", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.crear")!;
    const staleReauth = new Date(Date.now() - 60 * 60 * 1000); // 1h ago, window is 15 min
    const session: AuthenticatedSession = { ...fakeSession(["usuarios.crear"]), reautenticadaEn: staleReauth };

    await expect(
      entry.execute(
        { nombre: "A", apellido: "B", email: "a@b.com", dni: "1", roles: ["FARMACEUTICO"] },
        { session },
      ),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it("proceeds past the step-up check with a recent reautenticadaEn (reaches validation/transaction as usual)", async () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "usuarios.crear")!;
    const session: AuthenticatedSession = { ...fakeSession(["usuarios.crear"]), reautenticadaEn: new Date() };

    // Empty roles is a zod failure, reached only if step-up did NOT throw --
    // proves the recent-reauth path is not rejected by StepUpRequiredError.
    await expect(
      entry.execute({ nombre: "A", apellido: "B", email: "a@b.com", dni: "1", roles: [] }, { session }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
