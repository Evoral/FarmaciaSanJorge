/**
 * The use-case pipeline (plan §8 / docs/architecture.md, FASE 2 point 2.7):
 * `requireSession -> authorize -> zod.parse -> transaction -> audit ->
 * mapDbError`. `defineCommand`/`defineQuery` are the ONLY way to build a
 * use case in this codebase -- there is no lower-level escape hatch -- so
 * the pipeline order is structurally guaranteed, not just documented
 * convention: a Server Action that wants to touch the database has
 * nothing to call except the `execute()` this file hands back, and that
 * function always runs `authorize()` before anything else happens.
 *
 * `defineCommand` (writes): opens `withTenantTransaction` and requires the
 * handler to hand back `audit` data (or the command must explicitly opt
 * out via `audit: { skip: true, reason }`) -- see the `audit` field below.
 *
 * `defineQuery` (reads): same `requireSession -> authorize -> zod.parse`
 * prefix, then runs the handler inside a (read-only) `withTenantTransaction`
 * too -- NOT because reads need atomicity, but because
 * `withTenantTransaction` is the only mechanism that sets `app.tenant_id`
 * for RLS (`set_config(..., true)` is transaction-local, see
 * shared/db/transaction.ts), so even a pure read needs a transaction scope
 * to see any tenant-scoped row at all. Queries never call `audit.record`.
 *
 * Every entry created this way is pushed to an in-process registry
 * (`listRegisteredUseCases`), which is what makes "every registered use
 * case calls authorize" a real, executable test
 * (tests/unit/usecase.test.ts) instead of a convention someone can forget.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { TipoAccion } from "@/generated/prisma/client";
import { requireSession, requireRecentReauth } from "@/shared/auth/session";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { authorize } from "@/shared/auth/authorize";
import type { Permiso } from "@/shared/auth/authorize";
import { withTenantTransaction } from "@/shared/db/transaction";
import { ValidationError } from "@/shared/errors";
import { record as auditRecord } from "@/shared/audit";

export { TipoAccion };

/** Data for the one `audit.record` write a command may perform, returned by the handler alongside its result. `entidadId` is required because only the handler (post-write) knows which row was affected. */
export interface AuditWrite {
  entidadId: string;
  valorAnterior?: Prisma.InputJsonValue | null;
  valorNuevo?: Prisma.InputJsonValue | null;
  motivo?: string;
  autorizadoPorId?: string;
  contexto?: Prisma.InputJsonValue;
  ip?: string;
}

/**
 * A command must declare either what it audits (`entidad`/`accion`, used
 * for every invocation of that command) or explicitly opt out with a
 * `reason` -- there is no third, silent option. This is what makes
 * "forgetting auditing" a deliberate act: TypeScript will not let
 * `defineCommand` compile without one of the two.
 */
export type AuditDeclaration = { entidad: string; accion: TipoAccion } | { skip: true; reason: string };

export interface CommandHandlerArgs<TInput> {
  tx: Prisma.TransactionClient;
  session: AuthenticatedSession;
  input: TInput;
}

export interface CommandHandlerResult<TOutput> {
  output: TOutput;
  /** Required unless the command's `audit` declaration is `{ skip: true, ... }` -- checked at runtime (see `defineCommand`), since a handler's return type can't be conditioned on a sibling config field in a way that stays ergonomic. */
  audit?: AuditWrite;
}

export interface DefineCommandConfig<TInput, TOutput> {
  name: string;
  permiso: Permiso;
  input: z.ZodType<TInput>;
  audit: AuditDeclaration;
  /**
   * FASE 2 point 2.5 / INV-X02 (step-up). When set, the pipeline calls
   * `requireRecentReauth(session, maxAgeMinutes)` right after `authorize()`
   * and before `zod.parse` -- a command that needs a recent
   * re-authentication (confirmar preparación, firmar cierre, in later
   * phases) declares it here instead of every handler re-implementing the
   * check. Omitted by default (most commands never need it); throws
   * `StepUpRequiredError` (shared/errors) before opening a transaction.
   */
  requireRecentReauth?: { maxAgeMinutes: number };
  handler: (args: CommandHandlerArgs<TInput>) => Promise<CommandHandlerResult<TOutput>>;
}

export interface QueryHandlerArgs<TInput> {
  tx: Prisma.TransactionClient;
  session: AuthenticatedSession;
  input: TInput;
}

export interface DefineQueryConfig<TInput, TOutput> {
  name: string;
  permiso: Permiso;
  input: z.ZodType<TInput>;
  handler: (args: QueryHandlerArgs<TInput>) => Promise<TOutput>;
}

/** Lets tests (and, in principle, trusted internal callers that already hold a verified session) skip the real `requireSession()` cookie/DB round trip. Production Server Actions/route handlers never pass this. */
export interface ExecuteOptions {
  session?: AuthenticatedSession;
}

export interface DefinedUseCase<TOutput> {
  readonly name: string;
  readonly permiso: Permiso;
  execute(rawInput: unknown, options?: ExecuteOptions): Promise<TOutput>;
}

export interface RegisteredUseCase {
  kind: "command" | "query";
  name: string;
  permiso: Permiso;
}

/** Internal registry entry: same as `RegisteredUseCase` plus the callable `execute`, so a test can actually INVOKE every registered use case (not just inspect its metadata) -- see `listRegisteredUseCasesForTests`. */
interface InternalRegistryEntry extends RegisteredUseCase {
  execute: (rawInput: unknown, options?: ExecuteOptions) => Promise<unknown>;
}

let registry: InternalRegistryEntry[] = [];

/** Every use case defined via `defineCommand`/`defineQuery` in the current module graph (metadata only). */
export function listRegisteredUseCases(): readonly RegisteredUseCase[] {
  return registry.map(({ kind, name, permiso }) => ({ kind, name, permiso }));
}

/**
 * Test-only: same entries as `listRegisteredUseCases`, but including the
 * real callable `execute`. This is what makes "every registered use case
 * calls authorize" an executable test (tests/unit/usecase.test.ts) instead
 * of a structural claim taken on faith: the test calls `entry.execute(...)`
 * with a permissionless session for every entry here and asserts it
 * rejects with `AuthorizationError`.
 */
export function listRegisteredUseCasesForTests(): readonly InternalRegistryEntry[] {
  return registry;
}

/** Test-only: clears the registry (mirrors `resetEnvCacheForTests`/`resetLoggerForTests` elsewhere in shared/). */
export function resetUsecaseRegistryForTests(): void {
  registry = [];
}

function parseInput<TInput>(schema: z.ZodType<TInput>, rawInput: unknown): TInput {
  const result = schema.safeParse(rawInput);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new ValidationError(`Invalid input: ${issues.join("; ")}`);
  }
  return result.data;
}

/**
 * SECURITY: an injected session is honoured ONLY under NODE_ENV=test.
 * Otherwise the session always comes from the session cookie via
 * requireSession(), so no production code path can hand the pipeline a
 * hand-built session (and with it, arbitrary permissions and tenant).
 */
async function resolveSession(options?: ExecuteOptions): Promise<AuthenticatedSession> {
  if (options?.session) {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("defineCommand/defineQuery: injecting a session is only allowed under NODE_ENV=test");
    }
    return options.session;
  }
  return requireSession();
}

/** Fails at module load (not at call time) if an audit opt-out carries no real reason. */
function assertAuditDeclaration(name: string, audit: AuditDeclaration): void {
  if ("skip" in audit && audit.reason.trim().length < 10) {
    throw new Error(
      `defineCommand("${name}"): audit {skip: true} needs a substantive reason (>= 10 chars) explaining why this write leaves no audit trail (INV-A01).`,
    );
  }
}

/** Writes (mutating Server Actions / route handlers). See the module doc comment for the full pipeline. */
export function defineCommand<TInput, TOutput>(config: DefineCommandConfig<TInput, TOutput>): DefinedUseCase<TOutput> {
  assertAuditDeclaration(config.name, config.audit);
  async function execute(rawInput: unknown, options?: ExecuteOptions): Promise<TOutput> {
    const session = await resolveSession(options);
    authorize(session, config.permiso);
    if (config.requireRecentReauth) {
      requireRecentReauth(session, config.requireRecentReauth.maxAgeMinutes);
    }
    const input = parseInput(config.input, rawInput);

    return withTenantTransaction(session.tenantId, async (tx) => {
      const result = await config.handler({ tx, session, input });

      if (!("skip" in config.audit)) {
        if (!result.audit) {
          throw new Error(
            `defineCommand("${config.name}"): declares audit {entidad: "${config.audit.entidad}", accion: "${config.audit.accion}"} ` +
              `but the handler did not return audit data. Return { output, audit } from the handler, or declare ` +
              `audit: { skip: true, reason: "..." } on the command.`,
          );
        }
        await auditRecord(tx, {
          tenantId: session.tenantId,
          usuarioId: session.usuario.id,
          entidad: config.audit.entidad,
          entidadId: result.audit.entidadId,
          accion: config.audit.accion,
          valorAnterior: result.audit.valorAnterior,
          valorNuevo: result.audit.valorNuevo,
          motivo: result.audit.motivo,
          autorizadoPorId: result.audit.autorizadoPorId,
          contexto: result.audit.contexto,
          ip: result.audit.ip,
        });
      }

      return result.output;
    });
  }

  registry.push({ kind: "command", name: config.name, permiso: config.permiso, execute: execute as InternalRegistryEntry["execute"] });

  return { name: config.name, permiso: config.permiso, execute };
}

/** Reads. See the module doc comment for why queries still open a tenant transaction. */
export function defineQuery<TInput, TOutput>(config: DefineQueryConfig<TInput, TOutput>): DefinedUseCase<TOutput> {
  async function execute(rawInput: unknown, options?: ExecuteOptions): Promise<TOutput> {
    const session = await resolveSession(options);
    authorize(session, config.permiso);
    const input = parseInput(config.input, rawInput);

    return withTenantTransaction(session.tenantId, (tx) => config.handler({ tx, session, input }));
  }

  registry.push({ kind: "query", name: config.name, permiso: config.permiso, execute: execute as InternalRegistryEntry["execute"] });

  return { name: config.name, permiso: config.permiso, execute };
}
