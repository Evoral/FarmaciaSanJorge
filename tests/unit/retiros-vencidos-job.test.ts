/**
 * Unit tests for the daily "retiro vencido" job (openspec/specs/retiro-vencido/spec.md RV1-RV3, RV10): the use case
 * (`runVencerRetirosJob`, `modules/entregas/application/vencer-retiros.ts`), the repository's audit/update step
 * (`marcarRetiroVencido`) and the route's constant-time secret check (`app/api/jobs/retiros-vencidos/route.ts`).
 * Modeled on tests/unit/archivo-plazos-job.test.ts. The SQL itself (lock + filter) is covered by the DB-side rules; here we
 * assert the job-runner's own responsibilities: iterate every tenant, isolate failures, skip a disabled tenant, compute the
 * cutoff from the tenant's jornada and zone, and audit each move as the tenant's SISTEMA usuario.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const DIAS_POR_TENANT: Record<string, number> = { "tenant-a": 30, "tenant-b": 7, "tenant-c": 0 };

const listActiveTenantIdsMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return ["tenant-a", "tenant-b", "tenant-c"];
});
const getSistemaUsuarioIdMock = vi.fn(async (...args: unknown[]) => `sistema-${args[1] as string}` as string | null);
const lockRecetasMock = vi.fn(async (...args: unknown[]) => {
  const tenantId = args[1] as string;
  return tenantId === "tenant-b" ? [{ id: "receta-1", preparadaEn: new Date("2026-10-01T15:00:00Z") }] : [];
});
const marcarRetiroVencidoMock = vi.fn(async (...args: unknown[]) => (args[1] as { recetas: unknown[] }).recetas.length);
const getDiasMock = vi.fn(async (...args: unknown[]) => DIAS_POR_TENANT[args[1] as string] ?? 30);
const jornadaActualMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return "2026-10-20";
});
const zonaHorariaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return "America/Argentina/Mendoza";
});

vi.mock("@/modules/entregas/infrastructure/retiro-vencido-repository", () => ({
  listActiveTenantIds: (...args: unknown[]) => listActiveTenantIdsMock(...args),
  getSistemaUsuarioId: (...args: unknown[]) => getSistemaUsuarioIdMock(...args),
  lockRecetasPreparadasVencidas: (...args: unknown[]) => lockRecetasMock(...args),
  marcarRetiroVencido: (...args: unknown[]) => marcarRetiroVencidoMock(...args),
}));

vi.mock("@/modules/entregas/infrastructure/entrega-repository", () => ({
  getDiasRetiroVencido: (...args: unknown[]) => getDiasMock(...args),
  jornadaActualTenant: (...args: unknown[]) => jornadaActualMock(...args),
  zonaHorariaTenant: (...args: unknown[]) => zonaHorariaMock(...args),
}));

vi.mock("@/shared/db/transaction", () => ({
  withPlatformTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ __platform: true })),
  withTenantTransaction: vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __tenant: tenantId })),
}));

vi.mock("@/shared/logging/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const { runVencerRetirosJob } = await import("@/modules/entregas/application/vencer-retiros");

beforeEach(() => {
  listActiveTenantIdsMock.mockReset().mockResolvedValue(["tenant-a", "tenant-b", "tenant-c"]);
  getSistemaUsuarioIdMock.mockReset().mockImplementation(async (...args: unknown[]) => `sistema-${args[1] as string}`);
  lockRecetasMock.mockReset().mockImplementation(async (...args: unknown[]) => {
    const tenantId = args[1] as string;
    return tenantId === "tenant-b" ? [{ id: "receta-1", preparadaEn: new Date("2026-10-01T15:00:00Z") }] : [];
  });
  marcarRetiroVencidoMock.mockReset().mockImplementation(async (...args: unknown[]) => (args[1] as { recetas: unknown[] }).recetas.length);
  getDiasMock.mockReset().mockImplementation(async (...args: unknown[]) => DIAS_POR_TENANT[args[1] as string] ?? 30);
  jornadaActualMock.mockReset().mockResolvedValue("2026-10-20");
  zonaHorariaMock.mockReset().mockResolvedValue("America/Argentina/Mendoza");
});

describe("runVencerRetirosJob", () => {
  it("iterates every active tenant and sums the recetas vencidas", async () => {
    const resultado = await runVencerRetirosJob();

    expect(resultado.tenantsProcesados).toBe(3);
    expect(resultado.recetasVencidas).toBe(1);
    expect(resultado.tenantsConError).toBe(0);
    expect(resultado.detalle.find((d) => d.tenantId === "tenant-b")).toMatchObject({ vencidas: 1, desactivado: false });
  });

  it("a tenant with dias_retiro_vencido = 0 is skipped: nothing is locked, read or written for it (RV1)", async () => {
    const resultado = await runVencerRetirosJob();

    expect(resultado.detalle.find((d) => d.tenantId === "tenant-c")).toMatchObject({ vencidas: 0, desactivado: true });
    expect(lockRecetasMock.mock.calls.map((c) => c[1])).toEqual(["tenant-a", "tenant-b"]);
    expect(getSistemaUsuarioIdMock.mock.calls.map((c) => c[1])).toEqual(["tenant-a", "tenant-b"]);
  });

  it("reads the parameter on every run and applies it per tenant (RV10)", async () => {
    await runVencerRetirosJob();
    const dias = marcarRetiroVencidoMock.mock.calls.map((c) => [(c[1] as { tenantId: string }).tenantId, (c[1] as { diasRetiroVencido: number }).diasRetiroVencido]);
    expect(dias).toEqual([
      ["tenant-a", 30],
      ["tenant-b", 7],
    ]);

    DIAS_POR_TENANT["tenant-b"] = 3;
    try {
      marcarRetiroVencidoMock.mockClear();
      await runVencerRetirosJob();
      expect((marcarRetiroVencidoMock.mock.calls[1]![1] as { diasRetiroVencido: number }).diasRetiroVencido).toBe(3);
    } finally {
      DIAS_POR_TENANT["tenant-b"] = 7;
    }
  });

  it("locks with the cutoff computed from the tenant's jornada and zone (start of jornada J - N + 1, local midnight)", async () => {
    await runVencerRetirosJob();

    const corteDe = (tenantId: string) => lockRecetasMock.mock.calls.find((c) => c[1] === tenantId)![2] as Date;
    // Mendoza is UTC-3: jornada 2026-10-20, N = 30 -> start of 2026-09-21; N = 7 -> start of 2026-10-14.
    expect(corteDe("tenant-a")).toEqual(new Date("2026-09-21T03:00:00Z"));
    expect(corteDe("tenant-b")).toEqual(new Date("2026-10-14T03:00:00Z"));
  });

  it("audits as the tenant's own SISTEMA usuario (RV3)", async () => {
    await runVencerRetirosJob();

    expect(marcarRetiroVencidoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: "tenant-b", sistemaId: "sistema-tenant-b", diasRetiroVencido: 7, recetas: [{ id: "receta-1", preparadaEn: new Date("2026-10-01T15:00:00Z") }] }),
    );
  });

  it("a tenant with no usuario SISTEMA fails in isolation -- the other tenants still run", async () => {
    getSistemaUsuarioIdMock.mockImplementation(async (...args: unknown[]) => ((args[1] as string) === "tenant-a" ? null : `sistema-${args[1] as string}`));

    const resultado = await runVencerRetirosJob();

    expect(resultado.tenantsProcesados).toBe(3);
    expect(resultado.tenantsConError).toBe(1);
    expect(resultado.recetasVencidas).toBe(1);
    expect(resultado.detalle.find((d) => d.tenantId === "tenant-a")).toMatchObject({ vencidas: 0, error: expect.stringContaining("SISTEMA") });
  });

  it("a tenant whose update throws fails in isolation -- the other tenants still run", async () => {
    marcarRetiroVencidoMock.mockImplementation(async (...args: unknown[]) => {
      if ((args[1] as { tenantId: string }).tenantId === "tenant-a") throw new Error("boom");
      return (args[1] as { recetas: unknown[] }).recetas.length;
    });

    const resultado = await runVencerRetirosJob();

    expect(resultado.tenantsConError).toBe(1);
    expect(resultado.recetasVencidas).toBe(1);
    expect(resultado.detalle.find((d) => d.tenantId === "tenant-a")).toMatchObject({ error: "boom" });
    expect(resultado.detalle.find((d) => d.tenantId === "tenant-b")!.error).toBeUndefined();
  });

  it("is idempotent from the caller's point of view: once nothing is PREPARADA and expired, a second run moves nothing", async () => {
    const primera = await runVencerRetirosJob();
    expect(primera.recetasVencidas).toBe(1);

    lockRecetasMock.mockResolvedValue([]);
    const segunda = await runVencerRetirosJob();

    expect(segunda.recetasVencidas).toBe(0);
    expect(segunda.tenantsConError).toBe(0);
  });
});

describe("marcarRetiroVencido (repository)", () => {
  async function loadRepository() {
    vi.resetModules();
    // The file-level vi.mock replaces this module for the use-case tests above; here we want the real one.
    vi.doUnmock("@/modules/entregas/infrastructure/retiro-vencido-repository");
    const auditRecord = vi.fn(async (...args: unknown[]) => {
      void args;
    });
    vi.doMock("@/shared/audit", () => ({ record: (...args: unknown[]) => auditRecord(...args), TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }) }));
    const repo = await import("@/modules/entregas/infrastructure/retiro-vencido-repository");
    return { repo, auditRecord };
  }

  const recetas = [
    { id: "r1", preparadaEn: new Date("2026-09-01T15:00:00Z") },
    { id: "r2", preparadaEn: new Date("2026-09-02T15:00:00Z") },
  ];

  it("moves PREPARADA -> RETIRO_VENCIDO and writes one CAMBIAR_ESTADO per receta as SISTEMA, with the plazo and preparada_en", async () => {
    const { repo, auditRecord } = await loadRepository();
    const updateMany = vi.fn(async () => ({ count: 2 }));

    const moved = await repo.marcarRetiroVencido({ receta: { updateMany } } as never, { tenantId: "t1", sistemaId: "sis-1", recetas, diasRetiroVencido: 30 });

    expect(moved).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({ where: { tenantId: "t1", id: { in: ["r1", "r2"] }, estado: "PREPARADA" }, data: { estado: "RETIRO_VENCIDO" } });
    expect(auditRecord).toHaveBeenCalledTimes(2);
    expect(auditRecord).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        tenantId: "t1",
        usuarioId: "sis-1",
        entidad: "receta",
        entidadId: "r1",
        accion: "CAMBIAR_ESTADO",
        valorAnterior: { estado: "PREPARADA" },
        valorNuevo: { estado: "RETIRO_VENCIDO" },
        contexto: { origen: "vencer-retiros", diasRetiroVencido: 30, preparadaEn: "2026-09-01T15:00:00.000Z" },
      }),
    );
  });

  it("nothing to move -> no write, no audit", async () => {
    const { repo, auditRecord } = await loadRepository();
    const updateMany = vi.fn(async () => ({ count: 0 }));

    expect(await repo.marcarRetiroVencido({ receta: { updateMany } } as never, { tenantId: "t1", sistemaId: "sis-1", recetas: [], diasRetiroVencido: 30 })).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("fewer rows moved than locked -> throws (the tenant's run rolls back) and audits nothing", async () => {
    const { repo, auditRecord } = await loadRepository();
    const updateMany = vi.fn(async () => ({ count: 1 }));

    await expect(repo.marcarRetiroVencido({ receta: { updateMany } } as never, { tenantId: "t1", sistemaId: "sis-1", recetas, diasRetiroVencido: 30 })).rejects.toThrow(/expected to move 2/);
    expect(auditRecord).not.toHaveBeenCalled();
  });
});

describe("/api/jobs/retiros-vencidos -- constant-time secret check", () => {
  async function loadRouteWithSecret(secret: string | undefined) {
    vi.resetModules();
    vi.doMock("@/shared/env", () => ({ getEnv: () => ({ CRON_SECRET: secret }) }));
    vi.doMock("@/modules/entregas/application/vencer-retiros", () => ({
      runVencerRetirosJob: vi.fn(async () => ({ tenantsProcesados: 2, recetasVencidas: 5, tenantsConError: 0, detalle: [{ tenantId: "secret-detail" }] })),
    }));
    vi.doMock("@/shared/logging/logger", () => ({ getLogger: () => ({ error: vi.fn() }) }));
    return import("@/app/api/jobs/retiros-vencidos/route");
  }
  const url = "http://localhost/api/jobs/retiros-vencidos";

  it("CRON_SECRET not configured -> 503 (GET and POST)", async () => {
    const { GET, POST } = await loadRouteWithSecret(undefined);
    expect((await GET(new Request(url))).status).toBe(503);
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(503);
  });

  it("missing credential -> 404", async () => {
    const { GET, POST } = await loadRouteWithSecret("s3cr3t");
    expect((await GET(new Request(url))).status).toBe(404);
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(404);
  });

  it("wrong credential -> 404", async () => {
    const { GET, POST } = await loadRouteWithSecret("s3cr3t");
    expect((await GET(new Request(url, { headers: { authorization: "Bearer wrong" } }))).status).toBe(404);
    expect((await POST(new Request(url, { method: "POST", headers: { "x-cron-secret": "wrong" } }))).status).toBe(404);
  });

  it("Authorization header without the Bearer prefix -> 404 (not treated as a raw secret)", async () => {
    const { GET } = await loadRouteWithSecret("s3cr3t");
    expect((await GET(new Request(url, { headers: { authorization: "s3cr3t" } }))).status).toBe(404);
  });

  it("correct Bearer token on GET (Vercel Cron) -> 200 with a counts-only JSON summary", async () => {
    const { GET } = await loadRouteWithSecret("s3cr3t");
    const response = await GET(new Request(url, { headers: { authorization: "Bearer s3cr3t" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenantsProcesados: 2, recetasVencidas: 5, tenantsConError: 0 });
  });

  it("correct x-cron-secret on POST -> 200", async () => {
    const { POST } = await loadRouteWithSecret("s3cr3t");
    const response = await POST(new Request(url, { method: "POST", headers: { "x-cron-secret": "s3cr3t" } }));
    expect(response.status).toBe(200);
  });
});
