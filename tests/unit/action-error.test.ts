/**
 * `AppError.fields` (shared/errors) and `actionError` (shared/ui/action-error.ts):
 * the field names a use case attaches to an error must reach the Server
 * Action's error state untouched, and nothing else about the state may change
 * (same message, same fallback, no `fields` key when there are none).
 */
import { describe, it, expect } from "vitest";
import { AppError, AuthorizationError, DomainError, ValidationError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";

describe("AppError fields", () => {
  it("ValidationError and DomainError carry the given fields; existing call signatures still work", () => {
    expect(new ValidationError("Fecha inválida.", { fields: ["fechaVencimiento"] }).fields).toEqual(["fechaVencimiento"]);
    expect(new DomainError("La droga está dada de baja.", { fields: ["drogaId"] }).fields).toEqual(["drogaId"]);
    expect(new ValidationError("Sin campos.").fields).toBeUndefined();
    expect(new DomainError("Sin campos.", { fields: [] }).fields).toBeUndefined();
  });

  it("still forwards `cause`, and sets it only when given", () => {
    const cause = new Error("root");
    expect(new ValidationError("x", { cause, fields: ["a"] }).cause).toBe(cause);
    expect("cause" in new ValidationError("x", { fields: ["a"] })).toBe(false);
  });
});

describe("actionError", () => {
  it("passes an AppError's message and fields through", () => {
    expect(actionError(new ValidationError("Número de vale obligatorio.", { fields: ["numeroValeAdquisicion"] }), "fallback")).toEqual({
      status: "error",
      message: "Número de vale obligatorio.",
      fields: ["numeroValeAdquisicion"],
    });
  });

  it("omits the fields key when the AppError has none", () => {
    const state = actionError(new AuthorizationError(), "fallback");
    expect(state).toEqual({ status: "error", message: "No tenés permiso para realizar esta acción." });
    expect("fields" in state).toBe(false);
  });

  it("returns a copy of the fields, not the error's own array", () => {
    const fields = ["lote"] as const;
    const state = actionError(new AppError("VALIDATION_ERROR", "x", { fields }), "fallback");
    expect(state.fields).toEqual(["lote"]);
    expect(state.fields).not.toBe(fields);
  });

  it("uses the fallback message for anything that is not an AppError", () => {
    expect(actionError(new Error("SELECT * FROM secret"), "No se pudo ingresar la partida.")).toEqual({
      status: "error",
      message: "No se pudo ingresar la partida.",
    });
    expect(actionError("boom", "Falló.")).toEqual({ status: "error", message: "Falló." });
  });
});
