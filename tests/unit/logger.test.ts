import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { REDACT_PATHS } from "@/shared/logging/logger";

// We build a logger with the exact same redact config as
// shared/logging/logger.ts (imported directly, so this can never drift from
// the real list -- see tests/unit/pacientes-logging-redaccion.test.ts for
// the FASE 4 point 4.5 patient-field additions) rather than importing
// getLogger() directly, because getLogger() is wired to pino-pretty (a
// transport, i.e. a worker thread) in development, which is awkward to
// capture synchronously in a unit test.

function captureLogLine(logFn: (logger: pino.Logger) => void): Record<string, unknown> {
  let captured = "";
  const stream = new Writable({
    write(chunk, _enc, callback) {
      captured += chunk.toString();
      callback();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, stream);
  logFn(logger);
  return JSON.parse(captured);
}

describe("logger redaction", () => {
  it("redacts a top-level password field", () => {
    const line = captureLogLine((log) => log.info({ password: "hunter2" }, "login attempt"));
    expect(line.password).toBe("[REDACTED]");
  });

  it("redacts a nested token field", () => {
    const line = captureLogLine((log) => log.info({ session: { token: "abc123" } }, "session created"));
    expect((line.session as Record<string, unknown>).token).toBe("[REDACTED]");
  });

  it("redacts DATABASE_URL / DIRECT_URL wherever they appear", () => {
    const line = captureLogLine((log) =>
      log.error({ env: { DATABASE_URL: "postgresql://user:pw@host/db" } }, "boot failed"),
    );
    expect((line.env as Record<string, unknown>).DATABASE_URL).toBe("[REDACTED]");
  });

  it("redacts the Authorization header", () => {
    const line = captureLogLine((log) => log.info({ req: { headers: { authorization: "Bearer xyz" } } }, "request"));
    expect(
      ((line.req as Record<string, unknown>).headers as Record<string, unknown>).authorization,
    ).toBe("[REDACTED]");
  });

  it("does not redact unrelated fields", () => {
    const line = captureLogLine((log) => log.info({ userId: "u_123", action: "login" }, "ok"));
    expect(line.userId).toBe("u_123");
    expect(line.action).toBe("login");
  });
});
