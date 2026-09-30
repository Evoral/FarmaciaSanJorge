/**
 * "Where from" for audit rows (M01; OWASP Logging Cheat Sheet: who, what,
 * when, WHERE, outcome): client IP, user agent and request id, read from
 * the current request's headers. Filled in automatically by
 * `audit.record()` so every row carries it -- including the direct
 * `auditRecord` calls outside `defineCommand` (login lockout, activation,
 * failed co-firmas).
 *
 * Never throws: outside a request scope (unit/DB tests, scripts, a future
 * background job) `headers()` is unavailable and every field is `null`.
 * `next/headers` is imported lazily for the same reason -- this module is
 * reachable from plain-Node entry points.
 *
 * Trust: on Vercel, `x-forwarded-for` is set by the platform edge (first
 * entry = the real client); `x-request-id` is always overwritten by
 * proxy.ts, so neither is client-controlled in production. The IP is
 * validated before it reaches the `inet` column (a malformed value would
 * otherwise abort the audited transaction).
 */
import { isIP } from "node:net";

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

const EMPTY: RequestContext = { ip: null, userAgent: null, requestId: null };
const MAX_USER_AGENT_LENGTH = 400;

/** First valid IP in `x-forwarded-for` (client, then proxies), else `x-real-ip`; `null` when neither parses as an IP. */
export function extractClientIp(forwardedFor: string | null, realIp: string | null): string | null {
  const candidates = [...(forwardedFor ?? "").split(","), realIp ?? ""].map((value) => value.trim());
  return candidates.find((value) => isIP(value) !== 0) ?? null;
}

export async function getRequestContext(): Promise<RequestContext> {
  try {
    const { headers } = await import("next/headers");
    const list = await headers();
    const userAgent = list.get("user-agent");
    return {
      ip: extractClientIp(list.get("x-forwarded-for"), list.get("x-real-ip")),
      userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
      // proxy.ts sets x-request-id for pages/Server Actions; /api routes (outside its matcher) fall back to Vercel's own per-request id.
      requestId: list.get("x-request-id") ?? list.get("x-vercel-id"),
    };
  } catch {
    return EMPTY;
  }
}
