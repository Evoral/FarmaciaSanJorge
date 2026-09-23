/**
 * Unit tests for `modules/auditoria/domain/cursor.ts` (M03, FASE 3 point
 * 3.11). Pure, DB-free -- see tests/db/auditoria-listado-cursor.test.ts
 * for the end-to-end proof that the composite cursor actually prevents
 * duplicates/gaps against the real DB.
 */
import { describe, it, expect } from "vitest";
import { ValidationError } from "@/shared/errors";
import { encodeCursor, decodeCursor } from "@/modules/auditoria/domain/cursor";

const ID_A = "11111111-1111-4111-a111-111111111111";
const ID_B = "22222222-2222-4222-a222-222222222222";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips ocurridoEn + id", () => {
    const ocurridoEn = new Date("2026-01-15T12:34:56.789Z");
    const encoded = encodeCursor({ ocurridoEn, id: ID_A });
    const decoded = decodeCursor(encoded);

    expect(decoded.ocurridoEn.toISOString()).toBe(ocurridoEn.toISOString());
    expect(decoded.id).toBe(ID_A);
  });

  it("two DIFFERENT (ocurridoEn, id) pairs never collide to the same cursor string", () => {
    const ocurridoEn = new Date("2026-01-15T12:34:56.789Z");
    const cursor1 = encodeCursor({ ocurridoEn, id: ID_A });
    const cursor2 = encodeCursor({ ocurridoEn, id: ID_B });
    const cursor3 = encodeCursor({ ocurridoEn: new Date("2026-01-15T12:34:56.790Z"), id: ID_A });

    expect(cursor1).not.toBe(cursor2);
    expect(cursor1).not.toBe(cursor3);
    expect(cursor2).not.toBe(cursor3);
  });

  it("decodes what it encodes even when ocurridoEn and id both vary across many samples", () => {
    for (let i = 0; i < 20; i += 1) {
      const ocurridoEn = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i));
      const id = i % 2 === 0 ? ID_A : ID_B;
      const decoded = decodeCursor(encodeCursor({ ocurridoEn, id }));
      expect(decoded.ocurridoEn.toISOString()).toBe(ocurridoEn.toISOString());
      expect(decoded.id).toBe(id);
    }
  });

  it("rejects a non-base64 garbage string", () => {
    expect(() => decodeCursor("not-a-valid-cursor-@@@")).toThrow(ValidationError);
  });

  it("rejects base64 that decodes to non-JSON", () => {
    const raw = Buffer.from("this is not json", "utf8").toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(ValidationError);
  });

  it("rejects a JSON payload missing 'id'", () => {
    const raw = Buffer.from(JSON.stringify({ ocurridoEn: new Date().toISOString() }), "utf8").toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(ValidationError);
  });

  it("rejects a JSON payload missing 'ocurridoEn'", () => {
    const raw = Buffer.from(JSON.stringify({ id: ID_A }), "utf8").toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(ValidationError);
  });

  it("rejects an invalid date string for ocurridoEn", () => {
    const raw = Buffer.from(JSON.stringify({ ocurridoEn: "not-a-date", id: ID_A }), "utf8").toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(ValidationError);
  });

  it("rejects a non-UUID id", () => {
    const raw = Buffer.from(JSON.stringify({ ocurridoEn: new Date().toISOString(), id: "not-a-uuid" }), "utf8").toString(
      "base64url",
    );
    expect(() => decodeCursor(raw)).toThrow(ValidationError);
  });

  it("rejects a JSON array instead of an object", () => {
    const raw = Buffer.from(JSON.stringify([new Date().toISOString(), ID_A]), "utf8").toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(ValidationError);
  });

  it("rejects null", () => {
    const raw = Buffer.from(JSON.stringify(null), "utf8").toString("base64url");
    expect(() => decodeCursor(raw)).toThrow(ValidationError);
  });
});
