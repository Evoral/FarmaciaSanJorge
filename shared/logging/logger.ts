/**
 * Structured logging (pino). Patient/prescription data is never logged
 * (see plan §13 Seguridad); the redaction list below is a defense-in-depth
 * net for accidental inclusion of secrets, not a substitute for callers
 * being careful about what they pass to the logger.
 */
import pino from "pino";
import { getEnv } from "@/shared/env";

/** Exported so tests/unit/logger.test.ts (which builds its own pino instance to avoid the pino-pretty transport) and tests/unit/pacientes-logging-redaccion.test.ts can assert against the REAL list instead of a hand-duplicated copy that could silently drift from it. */
export const REDACT_PATHS = [
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
  // FASE 4 point 4.5 (pacientes, Ley 25.326 / DP-24): patient fields must
  // never appear in logs. modules/pacientes/** never passes a paciente
  // object (or its individual fields) to the logger in the first place --
  // this is defense-in-depth for the accidental case (e.g. an error object
  // that embeds the input it failed on). "dni"/"cuil" are unique enough
  // keys across this schema's other entities to redact unconditionally;
  // "nombre"/"apellido"/"telefono"/"email" collide with non-sensitive
  // fields elsewhere (drogas, proveedores, usuarios), so those are only
  // redacted when nested under a "paciente" key, matching the shape a
  // caller would actually log a patient record under.
  "dni",
  "*.dni",
  "*.*.dni",
  "cuil",
  "*.cuil",
  "*.*.cuil",
  "paciente.nombre",
  "*.paciente.nombre",
  "paciente.apellido",
  "*.paciente.apellido",
  "paciente.telefono",
  "*.paciente.telefono",
  "paciente.email",
  "*.paciente.email",
  "paciente.nroCredencial",
  "*.paciente.nroCredencial",
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
