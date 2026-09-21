/**
 * `audit.record(tx, ...)` (M01, plan §9 M01 / §16 FASE 1.3). Writes exactly
 * one row to `fsj.registro_auditoria` using the SAME transaction client the
 * caller's business writes are running in -- if that transaction rolls
 * back, the audit row rolls back with it (INV-A01: "no write data, then
 * audit" two-step). Never call this outside a `withTenantTransaction`.
 *
 * This is the ONLY place application code should construct a
 * `registro_auditoria` row -- in practice that means through
 * `shared/usecase.ts#defineCommand`'s `audit` option, which calls this and
 * always sources `usuarioId`/`tenantId` from the authenticated session,
 * never from request input (plan §9 M01 "NO HACER").
 *
 * `fsj.registro_auditoria` is DB-immutable (INV-A02: trigger + no
 * UPDATE/DELETE/TRUNCATE grants -- migration 0003) and `usuario_id` is
 * NOT NULL (INV-A03) -- both enforced independently at the DB layer, this
 * function does not need to re-check them.
 */
import type { Prisma } from "@/generated/prisma/client";
import { TipoAccion } from "@/generated/prisma/client";

export { TipoAccion };

/**
 * Input to `record`. `valorAnterior`/`valorNuevo`/`contexto` must NEVER
 * contain `password_hash`, `token_hash`, or any other credential/secret
 * (plan §9 M01 "NO HACER") -- callers are responsible for that; this
 * function does not attempt to redact, since it cannot know which fields
 * of an arbitrary JSON blob are sensitive for a given entidad.
 */
export interface AuditRecordInput {
  /** From the authenticated session -- never from client input. */
  tenantId: string;
  /** From the authenticated session -- never from client input. */
  usuarioId: string;
  /** Table/aggregate name, e.g. "usuario", "sesion" (free text, not FK-checked). */
  entidad: string;
  /** id of the affected row. */
  entidadId: string;
  accion: TipoAccion;
  valorAnterior?: Prisma.InputJsonValue | null;
  valorNuevo?: Prisma.InputJsonValue | null;
  motivo?: string;
  /** Set only when a second user authorized the action on behalf of/for the acting user (e.g. DT authorizing an adjustment). */
  autorizadoPorId?: string;
  /** Free-form context (request id, user-agent, etc.) -- never secrets. */
  contexto?: Prisma.InputJsonValue;
  ip?: string;
}

/** Writes one immutable audit row inside `tx`. */
export async function record(tx: Prisma.TransactionClient, input: AuditRecordInput): Promise<void> {
  await tx.registroAuditoria.create({
    data: {
      tenantId: input.tenantId,
      usuarioId: input.usuarioId,
      entidad: input.entidad,
      entidadId: input.entidadId,
      accion: input.accion,
      valorAnterior: input.valorAnterior ?? undefined,
      valorNuevo: input.valorNuevo ?? undefined,
      motivo: input.motivo,
      autorizadoPorId: input.autorizadoPorId,
      contexto: input.contexto ?? undefined,
      ip: input.ip,
    },
  });
}
