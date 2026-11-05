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
  });

  it("does not require DIRECT_URL at runtime (owner credential stays out of the app env)", () => {
    setEnv({ DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true", DIRECT_URL: undefined });
    expect(() => getEnv()).not.toThrow();
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

  it("treats an empty CRON_SECRET the same as unset instead of throwing", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      CRON_SECRET: "",
    });
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().CRON_SECRET).toBeUndefined();
  });

  it("treats a whitespace-only CRON_SECRET the same as unset instead of throwing", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      CRON_SECRET: "   ",
    });
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().CRON_SECRET).toBeUndefined();
  });

  it("keeps a real CRON_SECRET value untouched", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      CRON_SECRET: "s3cr3t",
    });
    expect(getEnv().CRON_SECRET).toBe("s3cr3t");
  });

  it("treats an empty GEMINI_API_KEY the same as unset instead of throwing", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      GEMINI_API_KEY: "",
    });
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().GEMINI_API_KEY).toBeUndefined();
  });

  it("treats a whitespace-only GEMINI_API_KEY the same as unset instead of throwing", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      GEMINI_API_KEY: "   ",
    });
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().GEMINI_API_KEY).toBeUndefined();
  });

  it("keeps a real GEMINI_API_KEY value untouched", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      GEMINI_API_KEY: "AIzaSyFakeKey123",
    });
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().GEMINI_API_KEY).toBe("AIzaSyFakeKey123");
  });

  it("defaults GEMINI_MODEL to gemini-3.5-flash-lite when unset", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      GEMINI_MODEL: undefined,
    });
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
  });

  it("defaults GEMINI_MODEL to gemini-3.5-flash-lite when empty or whitespace", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      GEMINI_MODEL: "   ",
    });
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
  });

  it("keeps a custom GEMINI_MODEL trimmed", () => {
    setEnv({
      DATABASE_URL: "postgresql://fsj_app.ref:pw@host:6543/postgres?pgbouncer=true",
      DIRECT_URL: "postgresql://postgres:pw@host:5432/postgres",
      GEMINI_MODEL: "  gemini-2.5-pro  ",
    });
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().GEMINI_MODEL).toBe("gemini-2.5-pro");
  });
});
