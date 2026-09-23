/// <reference types="vite/client" />
/**
 * Cross-module automatic use-case discovery + authorize()-first guarantee
 * (N3, security review). Supersedes the hardcoded 11-import list that used
 * to live in tests/unit/usuarios-usecase-registry.test.ts: that list
 * silently stopped covering anything the moment a NEW
 * modules/*\/application/*.ts file was added anywhere in the app (a later
 * phase's module, for instance) -- a command that forgot to wire
 * `authorize()` would only be caught if someone remembered to add its name
 * to that list by hand.
 *
 * This file instead globs EVERY modules/*\/application/**\/*.ts file (Vite's
 * `import.meta.glob`, eager -- Vitest runs on Vite, so this works exactly
 * like it would in application code; see the `/// <reference types="vite/client" />`
 * above, which is what makes `import.meta.glob`'s TYPE known to `tsc`
 * without touching the project-wide tsconfig.json) and proves the same
 * guarantee tests/unit/usecase.test.ts proves for shared/usecase.ts
 * itself: every `defineCommand`/`defineQuery` registers, and every
 * registered entry rejects a permissionless session with
 * `AuthorizationError` before ever opening a transaction. Deliberately a
 * SEPARATE, GENERIC file (not usuarios-specific) -- see
 * tests/unit/usuarios-usecase-registry.test.ts for the usuarios-specific
 * INPUT VALIDATION tests (empty roles, invalid email, missing motivo,
 * etc.) and the M2 step-up regression test, which still belong there
 * because they assert business rules of THAT module, not the generic
 * cross-module guarantee this file is about.
 *
 * A generic glob-import necessarily also imports files that never call
 * `defineCommand`/`defineQuery` at all (plain helper functions such as
 * modules/auth/application/require-session.ts, create-session.ts,
 * touch-session.ts, etc.) -- those still have to import cleanly, which
 * means anything with a module-load-time side effect must be mocked here
 * even though nothing in this file ever calls it directly:
 *
 *   - `next/headers`: modules/auth/infrastructure/cookie-store.ts imports
 *     `cookies` from it (reached transitively via require-session.ts).
 *     Outside a real Next.js request scope -- this is a plain Vitest/node
 *     run -- resolving that import can throw before any test even runs.
 *     Mocked with a stub that this file never actually invokes (nothing
 *     here calls the real `requireSession()`; every use case is invoked
 *     with an injected `{ session }` instead).
 *   - `@/shared/db/transaction` / `@/shared/audit`: same reason
 *     tests/unit/usecase.test.ts mocks them -- `withTenantTransaction`
 *     would otherwise open a REAL Prisma connection (via
 *     `@/shared/db/client`'s lazily-created singleton) the moment any
 *     command's handler ran. This file proves PIPELINE WIRING only (no DB
 *     at all) -- DB behavior is tests/db/*.
 *   - `@/shared/auth/session`: `requireSession` is stubbed to throw if
 *     ever actually called (a real call here would mean some use case is
 *     NOT going through the injected-session path this test relies on);
 *     `requireRecentReauth` is left a permissive no-op so use cases that
 *     declare it (crearUsuario, suspender, reactivar, baja,
 *     restablecerCredencial, cambiarRoles) don't need a real
 *     `reautenticadaEn` timestamp just to reach the authorize() check this
 *     file actually tests -- the step-up behavior itself has its own
 *     dedicated regression test (tests/unit/usuarios-usecase-registry.test.ts's
 *     M2 case), which deliberately uses the REAL step-up policy instead.
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError } from "@/shared/errors";

vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("next/headers cookies() unexpectedly called -- this test never runs a real request.");
  },
}));

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
  throw new Error(
    "requireSession() unexpectedly called -- every use case in this test is invoked with an injected session via execute(input, { session })",
  );
});
vi.mock("@/shared/auth/session", () => ({
  requireSession: () => requireSessionMock(),
  requireRecentReauth: vi.fn(),
}));

// Eagerly imports (and thereby side-effect-registers, via
// defineCommand/defineQuery) EVERY application use case in the codebase,
// present or future -- this is what makes "a use case that forgot
// authorize()" a structural impossibility to miss, instead of a hope that
// someone remembers to update a hardcoded list.
const discoveredModules = import.meta.glob("../../modules/*/application/**/*.ts", { eager: true });

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

describe("every modules/*/application/**/*.ts file is discovered", () => {
  it("globbed at least one application module from every business module that has an application/ layer", () => {
    const paths = Object.keys(discoveredModules);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p.includes("/modules/auth/application/"))).toBe(true);
    expect(paths.some((p) => p.includes("/modules/usuarios/application/"))).toBe(true);
  });
});

describe("every registered use case (any module) is structurally forced through authorize()", () => {
  it("rejects a permissionless session for EVERY registered use case in the codebase, before touching a transaction", async () => {
    const registered = listRegisteredUseCasesForTests();
    // Sanity floor: at least the FASE 2 (auth) + FASE 3 (usuarios) use
    // cases known at the time this test was written -- guards against the
    // glob silently matching nothing (e.g. a path typo) and this test
    // passing vacuously.
    expect(registered.length).toBeGreaterThanOrEqual(11);

    const noPermisos = fakeSession([]);
    withTenantTransactionMock.mockClear();
    auditRecordMock.mockClear();

    for (const entry of registered) {
      expect(entry.permiso, `use case "${entry.name}" registered with an empty permiso`).toBeTruthy();
      await expect(
        entry.execute({}, { session: noPermisos }),
        `use case "${entry.name}" did not call authorize() first`,
      ).rejects.toBeInstanceOf(AuthorizationError);
    }

    expect(withTenantTransactionMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });
});
