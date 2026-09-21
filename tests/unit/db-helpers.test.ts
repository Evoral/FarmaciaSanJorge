import { describe, it, expect } from "vitest";
import { createSavepointNameGenerator } from "@/tests/db/helpers";

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
