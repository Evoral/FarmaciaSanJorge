/**
 * Unit tests for FASE 12 point 12.2 (M15): the daily job's per-tenant
 * isolation (`runActualizarPlazosJob`, `modules/archivo/application/actualizar-plazos.ts`)
 * and the route handler's constant-time secret check
 * (`app/api/jobs/plazos-archivo/route.ts`). Idempotency itself is a DB
 * guarantee (the job's SQL only ever matches `EN_ARCHIVO` rows -- see the
 * repository's doc comment); here we assert the job-runner's OWN
 * responsibility: iterate every tenant, and never let one tenant's failure
 * stop the rest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const listActiveTenantIdsMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return ["tenant-a", "tenant-b", "tenant-c"];
});
const getSistemaUsuarioIdMock = vi.fn(async (...args: unknown[]) => {
  const tenantId = args[1] as string;
  return `sistema-${tenantId}` as string | null;
});
const moverPlazoCumplidoTenantMock = vi.fn(async (...args: unknown[]) => {
  const tenantId = args[1] as string;
  return tenantId === "tenant-b" ? [{ id: "lote-1", numero: "1" }] : [];
});

vi.mock("@/modules/archivo/infrastructure/archivo-repository", () => ({
  listActiveTenantIds: (...args: unknown[]) => listActiveTenantIdsMock(...args),
  getSistemaUsuarioId: (...args: unknown[]) => getSistemaUsuarioIdMock(...args),
  moverPlazoCumplidoTenant: (...args: unknown[]) => moverPlazoCumplidoTenantMock(...args),
}));

vi.mock("@/shared/db/transaction", () => ({
  withPlatformTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ __platform: true })),
  withTenantTransaction: vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __tenant: tenantId })),
}));

vi.mock("@/shared/logging/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const { runActualizarPlazosJob } = await import("@/modules/archivo/application/actualizar-plazos");

beforeEach(() => {
  listActiveTenantIdsMock.mockReset().mockResolvedValue(["tenant-a", "tenant-b", "tenant-c"]);
  getSistemaUsuarioIdMock.mockReset().mockImplementation(async (...args: unknown[]) => `sistema-${args[1] as string}`);
  moverPlazoCumplidoTenantMock.mockReset().mockImplementation(async (...args: unknown[]) => {
    const tenantId = args[1] as string;
    return tenantId === "tenant-b" ? [{ id: "lote-1", numero: "1" }] : [];
  });
});

describe("runActualizarPlazosJob", () => {
  it("iterates every active tenant and sums lotesMovidos across all of them", async () => {
    const resultado = await runActualizarPlazosJob();

    expect(resultado.tenantsProcesados).toBe(3);
    expect(resultado.lotesMovidos).toBe(1);
    expect(resultado.tenantsConError).toBe(0);
    expect(moverPlazoCumplidoTenantMock).toHaveBeenCalledTimes(3);
  });

  it("a tenant with no usuario SISTEMA fails in isolation -- the other tenants still run", async () => {
    getSistemaUsuarioIdMock.mockImplementation(async (...args: unknown[]) => {
      const tenantId = args[1] as string;
      return tenantId === "tenant-a" ? null : `sistema-${tenantId}`;
    });

    const resultado = await runActualizarPlazosJob();

    expect(resultado.tenantsProcesados).toBe(3);
    expect(resultado.tenantsConError).toBe(1);
    // tenant-b still moved its lote despite tenant-a's failure.
    expect(resultado.lotesMovidos).toBe(1);
    const tenantA = resultado.detalle.find((d) => d.tenantId === "tenant-a")!;
    expect(tenantA.ok).toBe(false);
    expect(tenantA.lotesMovidos).toBe(0);
  });

  it("a tenant whose moverPlazoCumplidoTenant throws fails in isolation -- the other tenants still run", async () => {
    moverPlazoCumplidoTenantMock.mockImplementation(async (...args: unknown[]) => {
      const tenantId = args[1] as string;
      if (tenantId === "tenant-c") throw new Error("boom");
      return tenantId === "tenant-b" ? [{ id: "lote-1", numero: "1" }] : [];
    });

    const resultado = await runActualizarPlazosJob();

    expect(resultado.tenantsConError).toBe(1);
    expect(resultado.lotesMovidos).toBe(1);
    expect(resultado.detalle.find((d) => d.tenantId === "tenant-c")!.ok).toBe(false);
    expect(resultado.detalle.find((d) => d.tenantId === "tenant-b")!.ok).toBe(true);
  });

  it("is idempotent from the caller's point of view: re-running with no more EN_ARCHIVO matches moves nothing", async () => {
    moverPlazoCumplidoTenantMock.mockResolvedValue([]);

    const resultado = await runActualizarPlazosJob();

    expect(resultado.lotesMovidos).toBe(0);
    expect(resultado.tenantsConError).toBe(0);
  });
});

describe("POST /api/jobs/plazos-archivo -- constant-time secret check (x-cron-secret)", () => {
  async function loadRouteWithSecret(secret: string | undefined) {
    vi.resetModules();
    vi.doMock("@/shared/env", () => ({ getEnv: () => ({ CRON_SECRET: secret }) }));
    vi.doMock("@/modules/archivo/application/actualizar-plazos", () => ({
      runActualizarPlazosJob: vi.fn(async () => ({ tenantsProcesados: 2, lotesMovidos: 1, tenantsConError: 0, detalle: [] })),
    }));
    vi.doMock("@/shared/logging/logger", () => ({ getLogger: () => ({ error: vi.fn() }) }));
    return import("@/app/api/jobs/plazos-archivo/route");
  }

  it("CRON_SECRET not configured -> 503", async () => {
    const { POST } = await loadRouteWithSecret(undefined);
    const response = await POST(new Request("http://localhost/api/jobs/plazos-archivo", { method: "POST" }));
    expect(response.status).toBe(503);
  });

  it("missing header -> 404", async () => {
    const { POST } = await loadRouteWithSecret("s3cr3t");
    const response = await POST(new Request("http://localhost/api/jobs/plazos-archivo", { method: "POST" }));
    expect(response.status).toBe(404);
  });

  it("wrong header -> 404", async () => {
    const { POST } = await loadRouteWithSecret("s3cr3t");
    const response = await POST(new Request("http://localhost/api/jobs/plazos-archivo", { method: "POST", headers: { "x-cron-secret": "wrong" } }));
    expect(response.status).toBe(404);
  });

  it("correct header -> 200 with a counts-only JSON summary", async () => {
    const { POST } = await loadRouteWithSecret("s3cr3t");
    const response = await POST(new Request("http://localhost/api/jobs/plazos-archivo", { method: "POST", headers: { "x-cron-secret": "s3cr3t" } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ tenantsProcesados: 2, lotesMovidos: 1, tenantsConError: 0 });
  });
});

describe("GET /api/jobs/plazos-archivo -- constant-time secret check (Vercel Cron: Authorization Bearer)", () => {
  async function loadRouteWithSecret(secret: string | undefined) {
    vi.resetModules();
    vi.doMock("@/shared/env", () => ({ getEnv: () => ({ CRON_SECRET: secret }) }));
    vi.doMock("@/modules/archivo/application/actualizar-plazos", () => ({
      runActualizarPlazosJob: vi.fn(async () => ({ tenantsProcesados: 2, lotesMovidos: 1, tenantsConError: 0, detalle: [] })),
    }));
    vi.doMock("@/shared/logging/logger", () => ({ getLogger: () => ({ error: vi.fn() }) }));
    return import("@/app/api/jobs/plazos-archivo/route");
  }

  it("CRON_SECRET not configured -> 503", async () => {
    const { GET } = await loadRouteWithSecret(undefined);
    const response = await GET(new Request("http://localhost/api/jobs/plazos-archivo", { method: "GET" }));
    expect(response.status).toBe(503);
  });

  it("missing Authorization header -> 404", async () => {
    const { GET } = await loadRouteWithSecret("s3cr3t");
    const response = await GET(new Request("http://localhost/api/jobs/plazos-archivo", { method: "GET" }));
    expect(response.status).toBe(404);
  });

  it("wrong bearer token -> 404", async () => {
    const { GET } = await loadRouteWithSecret("s3cr3t");
    const response = await GET(
      new Request("http://localhost/api/jobs/plazos-archivo", { method: "GET", headers: { authorization: "Bearer wrong" } }),
    );
    expect(response.status).toBe(404);
  });

  it("Authorization header without the Bearer prefix -> 404 (not treated as a raw secret)", async () => {
    const { GET } = await loadRouteWithSecret("s3cr3t");
    const response = await GET(
      new Request("http://localhost/api/jobs/plazos-archivo", { method: "GET", headers: { authorization: "s3cr3t" } }),
    );
    expect(response.status).toBe(404);
  });

  it("correct Bearer token -> 200 with a counts-only JSON summary", async () => {
    const { GET } = await loadRouteWithSecret("s3cr3t");
    const response = await GET(
      new Request("http://localhost/api/jobs/plazos-archivo", { method: "GET", headers: { authorization: "Bearer s3cr3t" } }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ tenantsProcesados: 2, lotesMovidos: 1, tenantsConError: 0 });
  });

  it("also accepts the legacy x-cron-secret header on GET (same credential, either transport)", async () => {
    const { GET } = await loadRouteWithSecret("s3cr3t");
    const response = await GET(
      new Request("http://localhost/api/jobs/plazos-archivo", { method: "GET", headers: { "x-cron-secret": "s3cr3t" } }),
    );
    expect(response.status).toBe(200);
  });
});
