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
 * A query may also declare an opt-in `prepare` step (same prefix, then
 * `prepare`, then the transaction): it runs after authorize + parse but
 * OUTSIDE any transaction, so network I/O never holds a pooled connection,
 * and its result reaches the handler as `prepared`.
 *
 * A session that lacks the use case's permiso is rejected by `authorize()`
 * before anything else runs -- and that rejection is itself audited
 * (`ACCESO_DENEGADO`, in its own short transaction, best-effort), see
 * `authorizeAuditado` below.
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
import { AuthorizationError, ValidationError } from "@/shared/errors";
import { record as auditRecord } from "@/shared/audit";
import { getLogger } from "@/shared/logging/logger";
import { formatIssuePath } from "@/shared/labels/field-labels";

// zod's built-in messages (enum, max length, type mismatches...) surface to
// the UI through `parseInput` below, so they must be Spanish like the custom
// ones in shared/validation. Global config, set here because every command
// and query parses its input through this file.
z.config(z.locales.es());

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

export interface QueryPrepareArgs<TInput> {
  session: AuthenticatedSession;
  input: TInput;
}

export interface QueryHandlerArgs<TInput, TPrepared = undefined> {
  tx: Prisma.TransactionClient;
  session: AuthenticatedSession;
  input: TInput;
  /** What `prepare` returned; `undefined` for a query that declares no `prepare`. */
  prepared: TPrepared;
}

export interface DefineQueryConfig<TInput, TOutput, TPrepared = undefined> {
  name: string;
  permiso: Permiso;
  input: z.ZodType<TInput>;
  /**
   * Opt-in step for work that must NOT hold a pooled DB connection, typically
   * network I/O (e.g. an external lookup that can take seconds). Runs AFTER
   * `authorize()` and `zod.parse`, OUTSIDE any transaction; its result reaches
   * the handler as `prepared`. A throw aborts the use case before a transaction
   * opens. Declare it BEFORE `handler` in the config literal so TypeScript
   * infers `TPrepared` from it.
   */
  prepare?: (args: QueryPrepareArgs<TInput>) => Promise<TPrepared>;
  handler: (args: QueryHandlerArgs<TInput, TPrepared>) => Promise<TOutput>;
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

/**
 * Internal registry entry: same as `RegisteredUseCase` plus the callable
 * `execute`, so a test can actually INVOKE every registered use case (not
 * just inspect its metadata) -- see `listRegisteredUseCasesForTests` -- and
 * the zod `input` schema, so a test can walk every field name a use case
 * accepts and prove each one has a human label in
 * shared/labels/field-labels.ts (the completeness guard in
 * tests/unit/usecase-registry-all-modules.test.ts). Deliberately NOT part
 * of the public `RegisteredUseCase` metadata: nothing outside tests has a
 * reason to reach into another use case's schema.
 */
interface InternalRegistryEntry extends RegisteredUseCase {
  execute: (rawInput: unknown, options?: ExecuteOptions) => Promise<unknown>;
  input: z.ZodType;
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

/**
 * The `ValidationError` message is shown verbatim in the UI, so each issue
 * is prefixed with the field's human label (`Matrícula: ...`), never the
 * raw code key (`numeroMatricula: ...`) -- see
 * shared/labels/field-labels.ts. Issues about the input as a whole
 * (empty path, e.g. a cross-field `superRefine` on the root object) get no
 * prefix: their message already stands on its own.
 *
 * The error also carries `fields`: the distinct top-level input keys with
 * an issue (`issue.path[0]`), which match the submitted form controls'
 * `name`s, so the UI can mark exactly those fields (shared/ui/field-errors.ts).
 */
function parseInput<TInput>(schema: z.ZodType<TInput>, rawInput: unknown): TInput {
  const result = schema.safeParse(rawInput);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const label = formatIssuePath(issue.path);
      return label ? `${label}: ${issue.message}` : issue.message;
    });
    const fields = [...new Set(result.error.issues.filter((issue) => issue.path.length > 0).map((issue) => String(issue.path[0])))];
    throw new ValidationError(`Datos inválidos: ${issues.join("; ")}`, { fields });
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

/**
 * `authorize()`, auditing a rejection before re-throwing it (OWASP: log
 * access-control failures). The UI hides every action a session cannot
 * perform, so a denial here means a tampered request, a forged URL or a
 * bug. The audit row is written in its OWN transaction (the operation
 * itself never starts) and best-effort: if it cannot be written, the
 * failure is logged and the caller still gets the original
 * AuthorizationError -- auditing must never change what the user sees.
 */
async function authorizeAuditado(session: AuthenticatedSession, casoDeUso: string, permiso: Permiso): Promise<void> {
  try {
    authorize(session, permiso);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      try {
        await withTenantTransaction(session.tenantId, (tx) =>
          auditRecord(tx, {
            tenantId: session.tenantId,
            usuarioId: session.usuario.id,
            entidad: "acceso",
            entidadId: session.usuario.id,
            accion: TipoAccion.ACCESO_DENEGADO,
            valorNuevo: { casoDeUso, permiso },
          }),
        );
      } catch (auditError) {
        try {
          getLogger().warn({ error: auditError, casoDeUso, permiso }, "Could not audit a denied access attempt");
        } catch {
          // Logging itself unavailable (e.g. logger env not configured): still surface the ORIGINAL denial below.
        }
      }
    }
    throw error;
  }
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
    await authorizeAuditado(session, config.name, config.permiso);
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

  registry.push({
    kind: "command",
    name: config.name,
    permiso: config.permiso,
    execute: execute as InternalRegistryEntry["execute"],
    input: config.input,
  });

  return { name: config.name, permiso: config.permiso, execute };
}

/** Reads. See the module doc comment for why queries still open a tenant transaction. */
export function defineQuery<TInput, TOutput, TPrepared = undefined>(
  config: DefineQueryConfig<TInput, TOutput, TPrepared>,
): DefinedUseCase<TOutput> {
  async function execute(rawInput: unknown, options?: ExecuteOptions): Promise<TOutput> {
    const session = await resolveSession(options);
    await authorizeAuditado(session, config.name, config.permiso);
    const input = parseInput(config.input, rawInput);
    const prepared = config.prepare ? await config.prepare({ session, input }) : (undefined as TPrepared);

    return withTenantTransaction(session.tenantId, (tx) => config.handler({ tx, session, input, prepared }));
  }

  registry.push({
    kind: "query",
    name: config.name,
    permiso: config.permiso,
    execute: execute as InternalRegistryEntry["execute"],
    input: config.input,
  });

  return { name: config.name, permiso: config.permiso, execute };
}
