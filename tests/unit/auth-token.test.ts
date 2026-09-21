import { describe, it, expect } from "vitest";
import { generateOpaqueToken, hashToken, TOKEN_BYTE_LENGTH } from "@/modules/auth/domain/token";

describe("generateOpaqueToken", () => {
  it("returns a base64url string decoding to TOKEN_BYTE_LENGTH bytes", () => {
    const token = generateOpaqueToken();
    expect(typeof token).toBe("string");
    expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true); // base64url charset, no padding
    expect(Buffer.from(token, "base64url").length).toBe(TOKEN_BYTE_LENGTH);
  });

  it("never repeats across many calls (256 bits of entropy)", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(1000);
  });
});

describe("hashToken", () => {
  it("is deterministic for the same input", () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("produces a 64-char lowercase hex SHA-256 digest", () => {
    expect(hashToken("some-raw-token")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different tokens hash to different values", () => {
    expect(hashToken(generateOpaqueToken())).not.toBe(hashToken(generateOpaqueToken()));
  });

  it("never returns the raw token itself (this is what makes it safe to persist)", () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).not.toBe(token);
  });
});
