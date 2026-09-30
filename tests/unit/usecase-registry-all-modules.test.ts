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
 *
 * The same discovered registry also backs a second cross-module guarantee
 * (last describe block): every field name any registered use case accepts
 * has a human label in shared/labels/field-labels.ts, so a validation
 * error never shows the user a raw code key. It lives here, not in its own
 * file, because it needs exactly this glob + these mocks to populate the
 * registry -- a second copy would be the same 40 lines drifting apart.
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import type { z } from "zod";
import { AuthorizationError } from "@/shared/errors";
import { FIELD_LABELS } from "@/shared/labels/field-labels";

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
  it("rejects a permissionless session for EVERY registered use case in the codebase, running nothing but the denial audit", async () => {
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

    // The operation itself never ran: the ONLY write each denial produced is its own ACCESO_DENEGADO audit row.
    expect(auditRecordMock).toHaveBeenCalledTimes(registered.length);
    expect(withTenantTransactionMock).toHaveBeenCalledTimes(registered.length);
    registered.forEach((entry, i) => {
      expect(auditRecordMock.mock.calls[i]![1]).toMatchObject({
        accion: "ACCESO_DENEGADO",
        entidad: "acceso",
        valorNuevo: { casoDeUso: entry.name, permiso: entry.permiso },
      });
    });
  });
});

/**
 * Every object key reachable from `schema`, via zod 4's internal `_zod.def`
 * (the same structure zod's own JSON-schema generator walks). Wrappers are
 * unwrapped to their inner type; a `pipe` contributes both ends (`in` is
 * what the user submitted, `out` may be a stricter re-parse); `lazy` is
 * skipped (no recursive input schemas exist, and following one blindly
 * could loop). Leaf types (string, enum, custom, ...) contribute nothing.
 */
function collectObjectKeys(schema: z.core.$ZodType, into: Set<string>, seen = new Set<z.core.$ZodType>()): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const def = schema._zod.def as z.core.$ZodTypeDef & Record<string, unknown>;
  const walk = (child: unknown) => collectObjectKeys(child as z.core.$ZodType, into, seen);
  switch (def.type) {
    case "object":
      for (const [key, child] of Object.entries(def.shape as Record<string, unknown>)) {
        into.add(key);
        walk(child);
      }
      if (def.catchall) walk(def.catchall);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
    case "nonoptional":
    case "success":
      walk(def.innerType);
      break;
    case "array":
      walk(def.element);
      break;
    case "pipe":
      walk(def.in);
      walk(def.out);
      break;
    case "union":
      for (const option of def.options as unknown[]) walk(option);
      break;
    case "intersection":
      walk(def.left);
      walk(def.right);
      break;
    case "record":
      walk(def.valueType);
      break;
    case "tuple":
      for (const item of def.items as unknown[]) walk(item);
      if (def.rest) walk(def.rest);
      break;
    default:
      break;
  }
}

describe("every input field of every registered use case has a human label", () => {
  it("maps every object key reachable from any registered input schema in FIELD_LABELS (shared/labels/field-labels.ts)", () => {
    const registered = listRegisteredUseCasesForTests();
    expect(registered.length).toBeGreaterThanOrEqual(11);

    const missing = new Map<string, string[]>();
    let totalKeys = 0;
    for (const entry of registered) {
      const keys = new Set<string>();
      collectObjectKeys(entry.input, keys);
      totalKeys += keys.size;
      for (const key of keys) {
        if (!Object.hasOwn(FIELD_LABELS, key)) missing.set(key, [...(missing.get(key) ?? []), entry.name]);
      }
    }
    // Guards against the walker silently matching nothing (e.g. a zod
    // internals change) and this test passing vacuously.
    expect(totalKeys).toBeGreaterThan(0);

    const report = [...missing].map(([key, useCases]) => `${key} (${useCases.join(", ")})`).sort();
    expect(report, "input keys with no entry in FIELD_LABELS -- add a Spanish label for each").toEqual([]);
  });
});
