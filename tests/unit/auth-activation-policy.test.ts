import { describe, it, expect } from "vitest";
import { isCredencialActiva } from "@/modules/auth/domain/activation-policy";

const NOW = new Date("2026-01-01T12:00:00Z");
const FUTURE = new Date(NOW.getTime() + 60_000);
const PAST = new Date(NOW.getTime() - 60_000);

describe("modules/auth/domain/activation-policy#isCredencialActiva (FASE 2 point 2.3, INV-AU-002 state machine)", () => {
  it("a fresh, unused, unrevoked, unexpired credential is active", () => {
    expect(isCredencialActiva({ usadaEn: null, revocadaEn: null, venceEn: FUTURE }, NOW)).toBe(true);
  });

  it("an already-used credential is never active again", () => {
    expect(isCredencialActiva({ usadaEn: PAST, revocadaEn: null, venceEn: FUTURE }, NOW)).toBe(false);
  });

  it("a revoked credential is never active", () => {
    expect(isCredencialActiva({ usadaEn: null, revocadaEn: PAST, venceEn: FUTURE }, NOW)).toBe(false);
  });

  it("an expired credential is not active, even if never used or revoked", () => {
    expect(isCredencialActiva({ usadaEn: null, revocadaEn: null, venceEn: PAST }, NOW)).toBe(false);
  });

  it("a credential expiring exactly at now is not active (strict greater-than, matches the DB's vence_en > now())", () => {
    expect(isCredencialActiva({ usadaEn: null, revocadaEn: null, venceEn: NOW }, NOW)).toBe(false);
  });

  it("used AND revoked (should never happen -- DB CHECK constraint forbids it) is still correctly rejected", () => {
    expect(isCredencialActiva({ usadaEn: PAST, revocadaEn: PAST, venceEn: FUTURE }, NOW)).toBe(false);
  });
});
