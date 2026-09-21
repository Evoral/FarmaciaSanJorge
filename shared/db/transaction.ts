/**
 * Transaction helpers that enforce the multi-tenant boundary (plan §8,
 * INV-T01). Every business-logic transaction MUST go through
 * `withTenantTransaction`, which sets `app.tenant_id` for the lifetime of
 * the transaction via `set_config(..., true)` (the `true` = "local to
 * transaction", which is what makes this safe with a transaction-mode
 * pooler such as Supavisor: the setting never leaks to another logical
 * session sharing the same physical connection).
 *
 * `withPlatformTransaction` is the explicit escape hatch for the small set
 * of genuinely tenant-less operations (platform operator managing tenants
 * themselves, M00). It does NOT set app.tenant_id, so RLS will hide every
 * tenant-scoped row -- by design. Never use it to bypass tenant isolation.
 */
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/shared/db/client";
import { mapDbError } from "@/shared/errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(tenantId: string): void {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new TypeError(`withTenantTransaction: tenantId must be a UUID, got: ${JSON.stringify(tenantId)}`);
  }
}

export type TenantTransactionCallback<T> = (tx: Prisma.TransactionClient) => Promise<T>;

/**
 * Runs `fn` inside an interactive transaction with `app.tenant_id` set to
 * `tenantId` for its duration. `tenantId` MUST come from the authenticated
 * session (`requireSession()`), never from client input, the URL, or headers.
 *
 * Postgres/Prisma errors thrown by `fn` are mapped via `mapDbError` before
 * propagating, so callers only ever see `AppError` subclasses.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  fn: TenantTransactionCallback<T>,
): Promise<T> {
  assertUuid(tenantId);
  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (tx) => {
      // set_config(..., true) = transaction-local: safe with Supavisor's
      // transaction-mode pooler, and automatically unset when the
      // transaction ends (commit or rollback), never leaking into the
      // next logical session on a reused physical connection.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

export type PlatformTransactionCallback<T> = (tx: Prisma.TransactionClient) => Promise<T>;

/**
 * Runs `fn` inside an interactive transaction WITHOUT setting
 * `app.tenant_id`. Only for genuinely tenant-less platform operations
 * (e.g. creating a new tenant). Because RLS policies key off
 * `app.tenant_id`, every tenant-scoped table is invisible inside this
 * transaction -- that's the point, not a bug.
 */
export async function withPlatformTransaction<T>(fn: PlatformTransactionCallback<T>): Promise<T> {
  const prisma = getPrismaClient();
  try {
    return await prisma.$transaction(fn);
  } catch (e) {
    throw mapDbError(e);
  }
}
