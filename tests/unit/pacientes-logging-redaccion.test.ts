/**
 * FASE 4 point 4.5 (pacientes, Ley 25.326 / DP-24): patient fields must
 * never appear in application logs. `modules/pacientes/**` never passes a
 * paciente object to a logger in the first place (verified by reading
 * every file in that module) -- this test proves the defense-in-depth net
 * (`shared/logging/logger.ts`'s `REDACT_PATHS`) actually catches the
 * accidental case too: a log call with a patient object must not print
 * DNI, CUIL or name. Same technique as tests/unit/logger.test.ts (a fresh
 * pino instance over a captured stream, avoiding the pino-pretty
 * transport), importing the REAL `REDACT_PATHS` so this can never drift
 * from shared/logging/logger.ts.
 */
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { REDACT_PATHS } from "@/shared/logging/logger";

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

const PACIENTE_DE_PRUEBA = {
  dni: "30123456",
  cuil: "20301234561",
  nombre: "Juan",
  apellido: "Pérez",
  telefono: "261-555-1234",
  email: "juan.perez@example.com",
  nroCredencial: "OS-987654",
};

describe("logger redaction -- FASE 4 point 4.5 (pacientes, DP-24)", () => {
  it("a log call with a top-level paciente object does not print DNI, CUIL or name", () => {
    const line = captureLogLine((log) => log.info({ paciente: PACIENTE_DE_PRUEBA }, "unexpected error while processing paciente"));
    const paciente = line.paciente as Record<string, unknown>;

    expect(paciente.dni).toBe("[REDACTED]");
    expect(paciente.cuil).toBe("[REDACTED]");
    expect(paciente.nombre).toBe("[REDACTED]");
    expect(paciente.apellido).toBe("[REDACTED]");
    expect(paciente.telefono).toBe("[REDACTED]");
    expect(paciente.email).toBe("[REDACTED]");
    expect(paciente.nroCredencial).toBe("[REDACTED]");

    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain(PACIENTE_DE_PRUEBA.dni);
    expect(serialized).not.toContain(PACIENTE_DE_PRUEBA.cuil);
    expect(serialized).not.toContain(PACIENTE_DE_PRUEBA.email);
  });

  it("redacts a bare top-level dni/cuil (e.g. an error context object built ad hoc, not nested under 'paciente')", () => {
    const line = captureLogLine((log) => log.error({ dni: "30123456", cuil: "20301234561" }, "lookup failed"));
    expect(line.dni).toBe("[REDACTED]");
    expect(line.cuil).toBe("[REDACTED]");
  });

  it("redacts dni/cuil nested one level deep under an arbitrary key", () => {
    const line = captureLogLine((log) => log.warn({ context: { dni: "30123456" } }, "warning"));
    expect((line.context as Record<string, unknown>).dni).toBe("[REDACTED]");
  });

  it("does NOT redact a non-patient 'nombre' field (e.g. droga.nombre) -- redaction is scoped to the 'paciente' key for that field, not global", () => {
    const line = captureLogLine((log) => log.info({ droga: { nombre: "Paracetamol" } }, "droga created"));
    expect((line.droga as Record<string, unknown>).nombre).toBe("Paracetamol");
  });
});
