/**
 * Verification methods (openspec/changes/metodos-verificacion-operador): the logger redaction and the audit label are
 * derived from the method catalog, so every method's proof is covered without naming it.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { REDACT_PATHS } from "@/shared/logging/logger";
import { campoDeOperador } from "@/shared/auth/operador-campos";
import { METODOS, METODOS_VERIFICACION } from "@/modules/auth/domain/verificacion-identidad";
import { AuditoriaDiff } from "@/modules/auditoria/ui/auditoria-diff";

function captureLogLine(logFn: (logger: pino.Logger) => void): Record<string, unknown> {
  let captured = "";
  const stream = new Writable({
    write(chunk, _enc, callback) {
      captured += chunk.toString();
      callback();
    },
  });
  logFn(pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, stream));
  return JSON.parse(captured);
}

describe("logger redaction per method", () => {
  for (const metodo of METODOS_VERIFICACION) {
    it(`redacts every ${metodo} proof key and form field at three levels`, () => {
      for (const clave of METODOS[metodo].claves) {
        for (const nombre of [clave, campoDeOperador(clave)]) {
          const line = captureLogLine((log) => log.info({ [nombre]: "s3cret", a: { [nombre]: "s3cret" }, b: { c: { [nombre]: "s3cret" } } }, "x"));
          expect(line[nombre]).toBe("[REDACTED]");
          expect((line.a as Record<string, unknown>)[nombre]).toBe("[REDACTED]");
          expect(((line.b as Record<string, Record<string, unknown>>).c)![nombre]).toBe("[REDACTED]");
        }
      }
    });
  }
});

describe("logger redaction of the huella", () => {
  it("redacts the huella proof key and its form field by name, at three levels", () => {
    for (const nombre of ["huella", "operadorHuella"]) {
      const line = captureLogLine((log) => log.info({ [nombre]: "H-884213", a: { [nombre]: "H-884213" }, b: { c: { [nombre]: "H-884213" } } }, "x"));
      expect(JSON.stringify(line)).not.toContain("H-884213");
    }
  });

  it("does not hide a permiso or droga code: the key is huella, not codigo", () => {
    const line = captureLogLine((log) => log.info({ codigo: "recetas.crear" }, "x"));
    expect(line.codigo).toBe("recetas.crear");
  });
});

describe("audit label of the verification method", () => {
  const render = (verificacion: string) =>
    renderToStaticMarkup(
      createElement(AuditoriaDiff, {
        entidad: "receta",
        entidadId: "1",
        valorAnterior: null,
        valorNuevo: null,
        zonaHoraria: "America/Argentina/Buenos_Aires",
        contexto: { terminal: { usuario: "Laboratorio" }, verificacion },
      }),
    );

  it("keeps the PIN reading as before", () => {
    expect(render("PIN")).toContain("identificado con PIN");
  });

  it("reads the huella as «identificado con huella»", () => {
    expect(render("HUELLA")).toContain("identificado con huella");
  });

  it("shows an unknown method code as stored", () => {
    expect(render("OTRO")).toContain("identificado con OTRO");
    expect(render("constructor")).toContain("identificado con constructor");
  });
});
