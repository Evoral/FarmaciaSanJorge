/**
 * Guard: the activation-by-code flow is gone for good (docs/specs/contrasena-temporal.md).
 * Source-text assertions only -- `proxy.ts` does not export `PUBLIC_PATHS`.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { AUTH_POLICY } from "@/shared/auth/policy";

const ROOT = resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|cjs|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("activation-by-code flow removed", () => {
  it.each([
    "app/(auth)/activar",
    "modules/auth/application/activar-cuenta.ts",
    "modules/auth/domain/activation-policy.ts",
    "modules/usuarios/ui/credencial-activacion.tsx",
    "tests/unit/auth-activation-policy.test.ts",
  ])("%s no longer exists", (path) => {
    expect(existsSync(resolve(ROOT, path))).toBe(false);
  });

  it("/activar is not a public path in proxy.ts", () => {
    const source = readFileSync(resolve(ROOT, "proxy.ts"), "utf8");
    const match = source.match(/const PUBLIC_PATHS = (\[[^\]]*\])/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain("/activar");
    expect(match![1]).toContain("/login");
  });

  it("AUTH_POLICY has no activation credential TTL", () => {
    expect(Object.keys(AUTH_POLICY)).not.toContain("activationCredentialTtlHours");
  });

  it("no source under app/, modules/, shared/ or scripts/ references the removed symbols", () => {
    const forbidden = ["activarCuenta", "consumeCredencialActivacion", "insertCredencialActivacion", "revokeCredencialesActivas", "credencial-activacion"];
    const offenders: string[] = [];
    for (const dir of ["app", "modules", "shared", "scripts"]) {
      for (const file of sourceFiles(resolve(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        for (const word of forbidden) {
          if (text.includes(word)) offenders.push(`${file.slice(ROOT.length + 1)}: ${word}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
