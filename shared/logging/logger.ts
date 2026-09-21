/**
 * Structured logging (pino). Patient/prescription data is never logged
 * (see plan §13 Seguridad); the redaction list below is a defense-in-depth
 * net for accidental inclusion of secrets, not a substitute for callers
 * being careful about what they pass to the logger.
 */
import pino from "pino";
import { getEnv } from "@/shared/env";

const REDACT_PATHS = [
  "password",
  "*.password",
  "*.*.password",
  "token",
  "*.token",
  "*.*.token",
  "cookie",
  "*.cookie",
  "req.headers.cookie",
  "req.headers.authorization",
  "*.authorization",
  "*.*.authorization",
  "DATABASE_URL",
  "*.DATABASE_URL",
  "DIRECT_URL",
  "*.DIRECT_URL",
];

let instance: pino.Logger | undefined;

function createLogger(): pino.Logger {
  // Reading LOG_LEVEL/NODE_ENV directly here (not via getEnv()) would
  // duplicate validation; getEnv() is safe to call lazily because pino
  // itself is only instantiated on first log call via `logger` below.
  const env = getEnv();

  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    ...(env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty", options: { colorize: true } } }
      : {}),
  });
}

/** Lazily-created singleton root logger. */
export function getLogger(): pino.Logger {
  if (!instance) instance = createLogger();
  return instance;
}

/** Creates a child logger tagged with a request id, for per-operation correlation. */
export function loggerForRequest(requestId: string): pino.Logger {
  return getLogger().child({ requestId });
}

/** Test-only: clears the singleton so tests can re-create it under a fresh env. */
export function resetLoggerForTests(): void {
  instance = undefined;
}
