/**
 * FASE 14 point 14.4: `GET /api/health` must report `db: "ok"` with a 200
 * when the trivial connectivity query succeeds, `db: "error"` with a 503
 * when it fails or hangs past the timeout, and never leak anything beyond
 * `{status, db, time}` (no stack traces, no versions, no tenant data).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRawMock = vi.fn(async () => [{ "?column?": 1 }]);
const getPrismaClientMock = vi.fn(() => ({ $queryRaw: queryRawMock }));
const errorLogMock = vi.fn();

vi.mock("@/shared/db/client", () => ({
  getPrismaClient: (...args: unknown[]) => getPrismaClientMock(...args),
}));
vi.mock("@/shared/logging/logger", () => ({
  loggerForRequest: () => ({ error: errorLogMock }),
}));

const { GET } = await import("@/app/api/health/route");

beforeEach(() => {
  queryRawMock.mockReset().mockResolvedValue([{ "?column?": 1 }]);
  getPrismaClientMock.mockReset().mockReturnValue({ $queryRaw: queryRawMock });
  errorLogMock.mockReset();
});

describe("GET /api/health", () => {
  it("db reachable -> 200, status/db both 'ok', no-store, only the documented fields", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(typeof body.time).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["db", "status", "time"]);
  });

  it("db query throws -> 503, status/db both 'error', failure logged but not exposed to the client", async () => {
    queryRawMock.mockRejectedValue(new Error("connection refused: password authentication failed for user fsj_app"));

    const response = await GET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("error");
    expect(body.db).toBe("error");
    expect(JSON.stringify(body)).not.toContain("fsj_app");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(errorLogMock).toHaveBeenCalledTimes(1);
  });

  it("getPrismaClient() itself throwing (e.g. missing env) is treated the same as a failed query -> 503", async () => {
    getPrismaClientMock.mockImplementation(() => {
      throw new Error("Invalid or missing environment variables: DATABASE_URL");
    });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.db).toBe("error");
  });
});
