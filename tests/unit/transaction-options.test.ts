/**
 * T5-03 regression tests: interactive transaction timeouts (audit P5-03).
 *
 * Audit finding T5-03:
 * - `withTenantTransaction` and `withPlatformTransaction` must pass `{ maxWait: 10_000, timeout: 60_000 }`
 *   to `prisma.$transaction(...)` to prevent batch imports (facturas, recetas, existencia inicial)
 *   from hitting Prisma's interactive-transaction 5s default timeout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const transactionMock = vi.fn();

vi.mock("@/shared/db/client", () => ({
  getPrismaClient: () => ({
    $transaction: (...args: unknown[]) => transactionMock(...args),
  }),
}));

const VALID_TENANT_ID = "00000000-0000-4000-a000-000000000001";
const EXPECTED_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

describe("T5-03: transaction options in withTenantTransaction and withPlatformTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("withTenantTransaction passes maxWait: 10000 and timeout: 60000 to prisma.$transaction", async () => {
    const { withTenantTransaction } = await import("@/shared/db/transaction");

    const fakeTx = {
      $executeRaw: vi.fn(async () => undefined),
    };

    transactionMock.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>, options: unknown) => {
      void options;
      return callback(fakeTx);
    });

    const callback = vi.fn(async () => "tenant-result");
    const result = await withTenantTransaction(VALID_TENANT_ID, callback);

    expect(result).toBe("tenant-result");
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), EXPECTED_OPTIONS);
    expect(callback).toHaveBeenCalledWith(fakeTx);
  });

  it("withPlatformTransaction passes maxWait: 10000 and timeout: 60000 to prisma.$transaction", async () => {
    const { withPlatformTransaction } = await import("@/shared/db/transaction");

    const fakeTx = {};
    transactionMock.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>, options: unknown) => {
      void options;
      return callback(fakeTx);
    });

    const callback = vi.fn(async () => "platform-result");
    const result = await withPlatformTransaction(callback);

    expect(result).toBe("platform-result");
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), EXPECTED_OPTIONS);
    expect(callback).toHaveBeenCalledWith(fakeTx);
  });
});
