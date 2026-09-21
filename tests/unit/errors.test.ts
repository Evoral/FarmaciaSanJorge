import { describe, it, expect } from "vitest";
import {
  AppError,
  DomainError,
  ValidationError,
  ConflictError,
  NotFoundError,
  InvariantViolationError,
  mapDbError,
  toSafeError,
} from "@/shared/errors";

describe("mapDbError", () => {
  it("extracts the INV-XXX code from a Postgres P0001 message", () => {
    const pgError = { code: "P2010", message: "raw query failed: INV-T03: tenant_id cannot be changed" };
    const mapped = mapDbError(pgError);
    expect(mapped).toBeInstanceOf(InvariantViolationError);
    expect((mapped as InvariantViolationError).invariantCode).toBe("INV-T03");
  });

  it("maps a unique constraint violation (P2002) to ConflictError", () => {
    const mapped = mapDbError({ code: "P2002", message: "Unique constraint failed" });
    expect(mapped).toBeInstanceOf(ConflictError);
  });

  it("maps a foreign key violation (P2003) to ConflictError", () => {
    const mapped = mapDbError({ code: "P2003", message: "Foreign key constraint failed" });
    expect(mapped).toBeInstanceOf(ConflictError);
  });

  it("maps a not-found error (P2025) to NotFoundError", () => {
    const mapped = mapDbError({ code: "P2025", message: "Record not found" });
    expect(mapped).toBeInstanceOf(NotFoundError);
  });

  it("passes an existing AppError through unchanged", () => {
    const original = new DomainError("something domain-specific");
    expect(mapDbError(original)).toBe(original);
  });

  it("wraps an unrecognized error as a generic AppError", () => {
    const mapped = mapDbError(new Error("connection reset"));
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe("INTERNAL_ERROR");
  });

  it("wraps a completely unknown thrown value", () => {
    const mapped = mapDbError("just a string");
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe("INTERNAL_ERROR");
  });
});

describe("toSafeError", () => {
  it("never leaks the raw Postgres message for a generic internal error", () => {
    const raw = new Error("password authentication failed for user \"fsj_owner\" at host 10.0.0.5");
    const safe = toSafeError(raw, "req-123");
    expect(safe.message).not.toContain("fsj_owner");
    expect(safe.message).not.toContain("10.0.0.5");
    expect(safe.requestId).toBe("req-123");
  });

  it("never leaks SQL text for an invariant violation, only the INV code", () => {
    const raw = { code: "P2010", message: "Raw query failed. Code: `P0001`. Message: `INV-T03: tenant_id cannot be changed on table receta`" };
    const safe = toSafeError(raw, "req-456");
    expect(safe.code).toBe("INV-T03");
    expect(safe.message).not.toContain("receta");
    expect(safe.message).not.toContain("SELECT");
  });

  it("passes through DomainError/ValidationError messages (authored for end users)", () => {
    const safe = toSafeError(new ValidationError("El campo email es obligatorio."), "req-789");
    expect(safe.message).toBe("El campo email es obligatorio.");
  });

  it("always includes the request id for support correlation", () => {
    const safe = toSafeError(new Error("anything"), "req-abc");
    expect(safe.requestId).toBe("req-abc");
  });
});
