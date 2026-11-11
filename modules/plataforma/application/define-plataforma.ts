/**
 * The platform use-case pipeline (openspec/specs/plataforma/spec.md P6):
 *
 *   requireSuperAdmin() -> zod -> withPlatformTransaction(handler) -> mapDbError
 *
 * Why not `defineCommand` / `defineQuery` (shared/usecase.ts): those require a tenant session and a permiso, and open a
 * tenant transaction; the superadmin has neither a tenant nor permisos. There is no `audit` step either: every platform
 * SQL function audits itself, in the same transaction, after deriving the actor from `actor.tokenHash` again
 * (fsj.plataforma_actor). So the guard here is the first gate, never the only one.
 *
 * This file is the only place in modules/plataforma allowed to open a transaction (eslint.config.mjs).
 */
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requireSuperAdmin, type SuperAdminSession } from "@/shared/auth/plataforma";
import { withPlatformTransaction } from "@/shared/db/transaction";
import { getRequestContext } from "@/shared/audit/request-context";
import { parseInput } from "@/shared/usecase";

export interface PlataformaHandlerArgs<TInput> {
  tx: Prisma.TransactionClient;
  actor: SuperAdminSession;
  input: TInput;
  /** For the platform audit row. */
  meta: { ip: string | null; requestId: string | null };
}

export interface DefinePlataformaConfig<TInput, TOutput> {
  name: string;
  input: z.ZodType<TInput>;
  /** Slow work outside the transaction (argon2 hashing), after the guard and the parse. */
  prepare?: (input: TInput) => Promise<TInput>;
  handler: (args: PlataformaHandlerArgs<TInput>) => Promise<TOutput>;
}

export interface PlataformaUseCase<TOutput> {
  name: string;
  execute: (rawInput: unknown) => Promise<TOutput>;
}

export function definePlataforma<TInput, TOutput>(config: DefinePlataformaConfig<TInput, TOutput>): PlataformaUseCase<TOutput> {
  return {
    name: config.name,
    async execute(rawInput: unknown): Promise<TOutput> {
      const actor = await requireSuperAdmin();
      const parsed = parseInput(config.input, rawInput);
      const input = config.prepare ? await config.prepare(parsed) : parsed;
      const { ip, requestId } = await getRequestContext();
      return withPlatformTransaction((tx) => config.handler({ tx, actor, input, meta: { ip, requestId } }));
    },
  };
}
