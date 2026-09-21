import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnv, resetEnvCacheForTests } from "@/shared/env";

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("getEnv", () => {
  beforeEach(() => {
    resetEnvCacheForTests();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetEnvCacheForTests();
  });

  it("throws a readable error listing missing variable names when required vars are absent", () => {
    setEnv({ DATABASE_URL: undefined, DIRECT_URL: undefined });
    expect(() => getEnv()).toThrowError(/DATABASE_URL/);
    expect(() => getEnv()).toThrowError(/DIRECT_URL/);
  });

  it("never includes variable values in the error message", () => {
    setEnv({ DATABASE_URL: undefined, DIRECT_URL: "postgresql://secret-host/should-not-leak" });
    let thrown: unknown;
    try {
      getEnv();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).not.toContain("secret-host");
    expect(message).not.toContain("should-not-leak");
  });

  it("returns validated env and defaults LOG_LEVEL when all required vars are present", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      LOG_LEVEL: undefined,
      NODE_ENV: undefined,
    });
    const env = getEnv();
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.NODE_ENV).toBe("development");
  });

  it("caches the result across calls until resetEnvCacheForTests() is called", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
    });
    const first = getEnv();
    setEnv({ DATABASE_URL: undefined });
    // Still cached -- does not re-validate (and therefore does not throw).
    expect(getEnv()).toBe(first);
  });
});
