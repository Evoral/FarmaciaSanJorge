import { describe, it, expect } from "vitest";
import { email } from "@/shared/validation";

describe("shared/validation#email", () => {
  it("accepts a well-formed address", () => {
    expect(email.parse("user@example.com")).toBe("user@example.com");
  });

  it("trims and lowercases before validating", () => {
    expect(email.parse("  User@Example.COM  ")).toBe("user@example.com");
  });

  it("rejects a malformed address", () => {
    expect(() => email.parse("not-an-email")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => email.parse("")).toThrow();
  });
});
