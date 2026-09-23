import { describe, it, expect } from "vitest";
import { createSavepointNameGenerator, isConnectionError } from "@/tests/db/helpers";

describe("tests/db/helpers#createSavepointNameGenerator", () => {
  it("returns unique, monotonically numbered names on successive calls", () => {
    const next = createSavepointNameGenerator();
    expect(next()).toBe("sp_1");
    expect(next()).toBe("sp_2");
    expect(next()).toBe("sp_3");
  });

  it("uses the given prefix", () => {
    const next = createSavepointNameGenerator("custom");
    expect(next()).toBe("custom_1");
    expect(next()).toBe("custom_2");
  });

  it("independent generators never collide with each other (simulates nested inSavepoint calls)", () => {
    const outer = createSavepointNameGenerator();
    const outerName = outer();

    // A nested inSavepoint sharing the SAME generator (the real usage in
    // tests/db/helpers.ts#inSavepoint, which shares one module-level
    // generator) must never reuse a name already handed out.
    const innerName = outer();
    expect(innerName).not.toBe(outerName);

    // A second, independent generator starts its own sequence from
    // scratch -- generators don't share state unless the caller shares
    // the same instance.
    const other = createSavepointNameGenerator();
    expect(other()).toBe("sp_1");
  });

  it("produces names that are valid unquoted Postgres identifiers (letters, digits, underscore only)", () => {
    const next = createSavepointNameGenerator();
    for (let i = 0; i < 20; i += 1) {
      expect(next()).toMatch(/^sp_[0-9]+$/);
    }
  });
});

describe("tests/db/helpers#isConnectionError", () => {
  function pgError(message: string, code?: string): Error {
    return Object.assign(new Error(message), code === undefined ? {} : { code });
  }

  it.each([
    ["pooler auth handshake timeout", pgError("(EAUTHTIMEOUT) timeout while waiting for message")],
    ["poisoned client", pgError("Client has encountered a connection error and is not queryable")],
    ["dropped socket", pgError("Connection terminated unexpectedly")],
    ["closed client", pgError("Client was closed and is not queryable")],
    ["connection exception class 08", pgError("connection failure", "08006")],
    ["admin shutdown", pgError("terminating connection due to administrator command", "57P01")],
    ["socket reset", pgError("read ECONNRESET", "ECONNRESET")],
  ])("treats %s as a connection error (retried)", (_label, error) => {
    expect(isConnectionError(error)).toBe(true);
  });

  // These MUST NOT be retried: they are exactly what the DB tests exist to
  // detect. Retrying them would hide a broken invariant.
  it.each([
    ["an invariant raised by our triggers", pgError("INV-S04: cantidad_disponible cannot be written directly", "P0001")],
    ["a CHECK violation", pgError("new row violates check constraint", "23514")],
    ["a unique violation", pgError("duplicate key value violates unique constraint", "23505")],
    ["a privilege error", pgError("permission denied for table partida", "42501")],
    ["an aborted transaction", pgError("current transaction is aborted, commands ignored until end of transaction block", "25P02")],
    ["an assertion failure", new Error("expected false to be true")],
  ])("does NOT treat %s as a connection error (never retried)", (_label, error) => {
    expect(isConnectionError(error)).toBe(false);
  });

  it("ignores non-Error values", () => {
    expect(isConnectionError("EAUTHTIMEOUT")).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });
});
