/**
 * Source-level guard for scripts/create-tenant.ts (CT1). The script runs
 * `main()` on import and talks to the shared DB as owner, so it cannot be
 * imported in a unit test: assert on its text instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../../scripts/create-tenant.ts"), "utf8");

describe("scripts/create-tenant.ts (CT1)", () => {
  it("creates the first admin ACTIVO with an argon2id temporary password that must be changed", () => {
    expect(source).toContain("debe_cambiar_password");
    expect(source).toContain("hashPassword(");
    expect(source).toContain("validatePassword(");
    expect(source).toMatch(/INSERT INTO fsj\.usuario[^`]*'ACTIVO', false/);
    expect(source).toContain("--admin-password-temporal");
  });

  it("no longer issues an activation credential", () => {
    expect(source).not.toContain("credencial_activacion");
    expect(source).not.toContain("activationCredentialTtlHours");
    expect(source).not.toContain("createHash");
    expect(source).not.toContain("randomBytes");
    expect(source).not.toContain("PENDIENTE_ACTIVACION");
  });

  it("never prints the temporary password", () => {
    const logCalls = source.split("\n").filter((line) => /console\.(log|error|info|warn)/.test(line));
    expect(logCalls.length).toBeGreaterThan(0);
    for (const line of logCalls) {
      // No interpolation or argument may carry the password variable.
      expect(line).not.toMatch(/\$\{[^}]*password/i);
      expect(line).not.toMatch(/console\.\w+\([^"'`]*password/i);
    }
  });
});
