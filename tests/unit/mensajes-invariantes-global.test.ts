/**
 * No end user may see an English or code-bearing error message.
 *
 * - The global INV translation table (shared/errors/mensajes-invariantes.ts)
 *   covers EVERY `INV-XXX` code the migrations raise -- scanned from
 *   prisma/migrations/** so a new `RAISE EXCEPTION 'INV-...'` without a
 *   Spanish message fails here.
 * - `userMessageFor` / `actionError` translate invariant violations, mask
 *   authentication/authorization internals, and use the action's fallback
 *   for unexpected errors.
 * - Error class defaults and `mapDbError` messages are Spanish.
 * - Module tables keep precedence and chain the global table before their
 *   own generic fallback.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  DomainError,
  InvariantViolationError,
  NotFoundError,
  StepUpRequiredError,
  ValidationError,
  MENSAJES_INVARIANTES,
  MENSAJE_INVARIANTE_GENERICO,
  mapDbError,
  mensajeParaInvariante,
  userMessageFor,
} from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";
import { mensajeParaInvarianteFirma, MENSAJES_INVARIANTES_FIRMA } from "@/modules/cierres/domain/mensajes-invariantes";
import { mensajeParaInvariante as mensajeConfirmacion } from "@/modules/preparaciones/domain/mensajes-invariantes";
import { validarItemsReceta } from "@/modules/recetas/domain/receta";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../prisma/migrations");

/** Every `INV-XXX` code raised by a `RAISE EXCEPTION` in a migration (SQL `--` comments stripped first). */
function codigosRaisedEnMigraciones(): Set<string> {
  const codigos = new Set<string>();
  for (const dir of fs.readdirSync(MIGRATIONS_DIR)) {
    const file = path.join(MIGRATIONS_DIR, dir, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8").replace(/--[^\n]*/g, "");
    for (const match of sql.matchAll(/RAISE\s+EXCEPTION\s+E?'(INV-[A-Z0-9]+(?:-[A-Z0-9]+)*)/g)) {
      codigos.add(match[1]!);
    }
  }
  return codigos;
}

const ENGLISH_MARKERS = /\b(the|is|not|cannot|must|requires?|found|invalid|already|does|exist|session|error occurred|unexpected|authorized|authentication)\b/i;

describe("global INV translation table", () => {
  const raised = codigosRaisedEnMigraciones();

  it("the migration scan actually finds the raised codes (sanity)", () => {
    expect(raised.size).toBeGreaterThan(50);
    expect(raised.has("INV-M01")).toBe(true);
  });

  it("has a Spanish message for EVERY INV code raised by the migrations", () => {
    const faltantes = [...raised].filter((codigo) => !Object.hasOwn(MENSAJES_INVARIANTES, codigo)).sort();
    expect(faltantes).toEqual([]);
  });

  it("every message is user-oriented Spanish: no INV code, no English, a reasonable single message", () => {
    for (const [codigo, mensaje] of Object.entries(MENSAJES_INVARIANTES)) {
      expect(mensaje, codigo).not.toMatch(/INV-/);
      expect(mensaje, codigo).not.toMatch(ENGLISH_MARKERS);
      expect(mensaje.length, codigo).toBeGreaterThan(15);
      expect(mensaje.length, codigo).toBeLessThan(300);
    }
  });

  it("falls back to a generic Spanish message for an unknown code, never the code itself", () => {
    expect(mensajeParaInvariante("INV-DOES-NOT-EXIST")).toBe(MENSAJE_INVARIANTE_GENERICO);
    expect(MENSAJE_INVARIANTE_GENERICO).toContain("Contactá al administrador");
  });
});

describe("userMessageFor / actionError", () => {
  const rawInvariant = {
    code: "P2010",
    message: "Raw query failed. Code: `P0001`. Message: `INV-M01: cannot convert unidad_medida x (MASA) into y (VOLUMEN): different tipo_magnitud`",
  };

  it("translates an InvariantViolationError (still carrying the raw DB text) via the global table", () => {
    const mapped = mapDbError(rawInvariant);
    expect(mapped).toBeInstanceOf(InvariantViolationError);
    const state = actionError(mapped, "No se pudo registrar el ingreso.");
    expect(state).toEqual({ status: "error", message: MENSAJES_INVARIANTES["INV-M01"] });
    expect(state.message).not.toContain("INV-");
    expect(state.message).not.toContain("tipo_magnitud");
  });

  it("uses the generic Spanish message for an INV code missing from the table", () => {
    expect(userMessageFor(new InvariantViolationError("INV-ZZZ-999", "INV-ZZZ-999: raw"), "fallback")).toBe(MENSAJE_INVARIANTE_GENERICO);
  });

  it("translates an INV code embedded in an otherwise user-facing AppError (defense in depth)", () => {
    expect(userMessageFor(new DomainError("INV-U02: user x must have at least one role"), "fallback")).toBe(MENSAJES_INVARIANTES["INV-U02"]);
  });

  it("keeps a module's own translated DomainError (module tables win)", () => {
    const moduleError = new DomainError(mensajeParaInvarianteFirma("INV-C19"), { cause: new InvariantViolationError("INV-C19", "INV-C19: raw") });
    expect(actionError(moduleError, "fallback").message).toBe(MENSAJES_INVARIANTES_FIRMA["INV-C19"]);
  });

  it("masks authentication/authorization internals (e.g. the missing permiso code) with fixed Spanish messages", () => {
    const authz = userMessageFor(new AuthorizationError("Session lacks required permission: stock.ajustar"), "fallback");
    expect(authz).toBe("No tenés permiso para realizar esta acción.");
    expect(authz).not.toContain("stock.ajustar");
    expect(userMessageFor(new AuthenticationError("raw detail"), "fallback")).toMatch(/Iniciá sesión/);
  });

  it("uses the action's fallback for INTERNAL_ERROR and for anything that is not an AppError", () => {
    expect(actionError(mapDbError(new Error("connection reset")), "No se pudo guardar.").message).toBe("No se pudo guardar.");
    expect(actionError(new Error("SELECT * FROM secret"), "No se pudo guardar.").message).toBe("No se pudo guardar.");
  });

  it("passes user-authored messages and fields through unchanged", () => {
    expect(actionError(new ValidationError("Fecha inválida.", { fields: ["fecha"] }), "fallback")).toEqual({
      status: "error",
      message: "Fecha inválida.",
      fields: ["fecha"],
    });
  });
});

describe("Spanish defaults", () => {
  it("error classes default to Spanish messages", () => {
    for (const error of [new AuthenticationError(), new AuthorizationError(), new StepUpRequiredError(), new NotFoundError()]) {
      expect(error.message, error.name).not.toMatch(ENGLISH_MARKERS);
      expect(error.message, error.name).toMatch(/[áéíóúñ]|No |Tu |Esta /);
    }
  });

  it("mapDbError produces Spanish messages for Prisma/driver errors", () => {
    const casos: [unknown, abstract new (...args: never[]) => AppError][] = [
      [{ code: "P2002", message: "Unique constraint failed" }, ConflictError],
      [{ code: "P2003", message: "Foreign key constraint failed" }, ConflictError],
      [{ code: "P2025", message: "Record not found" }, NotFoundError],
      [{ code: "P2039", message: "Database error. Code: `23P01`." }, ConflictError],
      [{ code: "P2034", message: "Transaction failed" }, ConflictError],
      [{ code: "P9999", message: "whatever" }, AppError],
      [new Error("connection reset"), AppError],
      ["just a string", AppError],
    ];
    for (const [raw, clase] of casos) {
      const mapped = mapDbError(raw);
      expect(mapped).toBeInstanceOf(clase);
      expect(mapped.message).not.toMatch(ENGLISH_MARKERS);
    }
  });
});

describe("module tables chain the global table", () => {
  it("a module table entry wins over the global one", () => {
    expect(mensajeParaInvarianteFirma("INV-U04")).toBe(MENSAJES_INVARIANTES_FIRMA["INV-U04"]);
    expect(MENSAJES_INVARIANTES_FIRMA["INV-U04"]).not.toBe(MENSAJES_INVARIANTES["INV-U04"]);
  });

  it("a code missing from the module table falls back to the global message, then to the module's generic one", () => {
    expect(mensajeParaInvarianteFirma("INV-U07")).toBe(MENSAJES_INVARIANTES["INV-U07"]);
    expect(mensajeConfirmacion("INV-DOES-NOT-EXIST")).toContain("No se pudo confirmar la preparación");
  });
});

describe("receta validation messages carry no internal rule code", () => {
  it("V1-V9 violations keep `regla` for diagnostics but the message has no code prefix", () => {
    try {
      validarItemsReceta([
        {
          formaFarmaceutica: "CAPSULA",
          cantidadUnidades: 0,
          fraccionDosisPorUnidad: "1",
          cantidadTotal: null,
          unidadTotalId: null,
          componentes: [],
        },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ regla: "V9" });
      expect((error as Error).message).not.toMatch(/^V\d/);
      expect((error as Error).message).toMatch(/^En el ítem 1/);
    }
  });
});
