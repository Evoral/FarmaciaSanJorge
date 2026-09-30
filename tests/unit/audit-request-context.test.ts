import { describe, it, expect, vi, beforeEach } from "vitest";

let requestHeaders: Headers | null = null;
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!requestHeaders) throw new Error("`headers` was called outside a request scope.");
    return requestHeaders;
  },
}));

const { extractClientIp, getRequestContext } = await import("@/shared/audit/request-context");
const { record } = await import("@/shared/audit");

function fakeTx() {
  const create = vi.fn(async (args: unknown) => args);
  return { tx: { registroAuditoria: { create } } as never, create };
}

const BASE = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  usuarioId: "22222222-2222-4222-8222-222222222222",
  entidad: "droga",
  entidadId: "33333333-3333-4333-8333-333333333333",
  accion: "MODIFICAR" as const,
};

beforeEach(() => {
  requestHeaders = null;
});

describe("extractClientIp", () => {
  it("takes the first entry of x-forwarded-for (the client), not the proxies after it", () => {
    expect(extractClientIp("200.45.10.7, 10.0.0.1", null)).toBe("200.45.10.7");
  });

  it("accepts IPv6 and falls back to x-real-ip", () => {
    expect(extractClientIp(null, "2800:810:1::1")).toBe("2800:810:1::1");
  });

  it("skips garbage instead of letting it reach the inet column", () => {
    expect(extractClientIp("not-an-ip, 190.1.2.3", null)).toBe("190.1.2.3");
    expect(extractClientIp("'; DROP TABLE x; --", "also bad")).toBeNull();
    expect(extractClientIp(null, null)).toBeNull();
  });
});

describe("getRequestContext", () => {
  it("is all-null (never throws) outside a request -- tests, scripts, jobs", async () => {
    await expect(getRequestContext()).resolves.toEqual({ ip: null, userAgent: null, requestId: null });
  });

  it("truncates an oversized user agent", async () => {
    requestHeaders = new Headers({ "user-agent": "x".repeat(2000) });
    expect((await getRequestContext()).userAgent).toHaveLength(400);
  });
});

describe("audit.record adds 'where from' automatically", () => {
  it("fills ip, user agent and request id from the current request", async () => {
    requestHeaders = new Headers({
      "x-forwarded-for": "200.45.10.7, 10.0.0.1",
      "user-agent": "Mozilla/5.0 Test",
      "x-request-id": "req-123",
    });
    const { tx, create } = fakeTx();
    await record(tx, BASE);
    expect(create.mock.calls[0]![0]).toMatchObject({
      data: { ip: "200.45.10.7", contexto: { requestId: "req-123", userAgent: "Mozilla/5.0 Test" } },
    });
  });

  it("explicit ip/contexto from the caller win over the automatic values", async () => {
    requestHeaders = new Headers({ "x-forwarded-for": "200.45.10.7", "x-request-id": "req-123" });
    const { tx, create } = fakeTx();
    await record(tx, { ...BASE, ip: "10.9.8.7", contexto: { requestId: "custom", origen: "job" } });
    expect(create.mock.calls[0]![0]).toMatchObject({ data: { ip: "10.9.8.7", contexto: { requestId: "custom", origen: "job" } } });
  });

  it("outside a request, writes the row without context instead of failing", async () => {
    const { tx, create } = fakeTx();
    await record(tx, BASE);
    const data = (create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.ip).toBeUndefined();
    expect(data.contexto).toBeUndefined();
  });
});
