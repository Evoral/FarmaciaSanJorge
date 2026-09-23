/**
 * Row-locking helpers for INV-USR-004 (plan §9 M03: "Enforce ... inside the
 * transaction, with a row lock so two admins acting at once cannot both
 * succeed in leaving zero admins") AND for M3's audit-trail correctness fix
 * (security review, FASE 3 hardening): every state-changing usuarios command
 * (suspender/reactivar/darDeBaja/restablecerCredencial/cambiarRoles) must lock its
 * TARGET row before reading `estado` for `estadoAnterior` -- otherwise two
 * concurrent admin actions on the same usuario can commit in an order that
 * makes the later write's `usuario_estado_historial`/`registro_auditoria`
 * "before" value LIE about what the state actually was (see those four
 * commands' doc comments for the concrete race).
 *
 * Explicit `tenant_id = $1` filter is a defense-in-depth complement to RLS
 * (plan §8 "no filtrar tenant a mano como única defensa"), not a
 * substitute for it -- `withTenantTransaction` has already set
 * `app.tenant_id` by the time this runs.
 *
 * ============================================================================
 * LOCK ORDER (read this before adding a new state-changing usuarios command)
 * ============================================================================
 * `lockUsuarioYAdministradoresActivos` is the ONLY way any usuarios command
 * may lock the target row + the last-admin guard set. It issues ONE
 * `SELECT ... WHERE (id = target OR <is ACTIVO admin>) ORDER BY id FOR
 * UPDATE OF u` statement -- deliberately NOT two separate statements (lock
 * target, then separately lock the admin set), and deliberately NOT
 * `LIMIT`ed (see migration 0018's B1 section for why `ORDER BY ... LIMIT
 * ... FOR UPDATE` is unsafe: EvalPlanQual re-checks only the already-chosen
 * row on a concurrent update, so a second transaction can miss a newer row
 * entirely).
 *
 * Why one ordered statement, not two: suppose suspenderUsuario locked its
 * target row first, then separately locked the admin set. Two admins
 * suspending EACH OTHER at once --
 *   T1 (suspends U_B, itself an ACTIVO admin): locks U_B, then tries to
 *      lock the admin set (which includes U_A) -- blocks on U_A.
 *   T2 (suspends U_A, itself an ACTIVO admin): locks U_A, then tries to
 *      lock the admin set (which includes U_B) -- blocks on U_B.
 * T1 holds U_B and waits for U_A; T2 holds U_A and waits for U_B: a
 * classic deadlock (Postgres detects it as SQLSTATE 40P01 and kills one
 * transaction, but that is a failure mode we can avoid entirely).
 *
 * The fix is the standard one for this shape of problem: acquire every row
 * this transaction will ever need to lock for this operation in ONE
 * statement, ordered by a stable key (`id`). Because `id` is `fsj.usuario`'s
 * primary key, an ordered lock query drives an index scan on the PK and
 * acquires row locks in ascending `id` order; two transactions racing over
 * an overlapping row set then always attempt to acquire the SAME first
 * contested row before any other, so whichever gets there first simply
 * makes the other wait (and proceeds once released) -- neither can end up
 * holding one row while waiting on another that the other side holds,
 * which is what a deadlock requires.
 *
 * ALL FIVE of suspender/reactivar/darDeBaja/restablecerCredencial/cambiarRoles call this
 * SAME function with the SAME query shape (even reactivar and
 * restablecerCredencial, which never need `idsAdminsActivos` for a
 * last-admin check) precisely so every state-changing usuarios command
 * locks in the same global order -- a future command that locked target+
 * admins with a DIFFERENT query/order would reintroduce the deadlock risk
 * above even if its own logic never uses the admin ids. Do not add a
 * second, differently-shaped lock query for this table; extend this one.
 *
 * Postgres deadlocks (40P01) and serialization failures (40001) are still
 * mapped defensively to a retryable `ConflictError` in `shared/errors`
 * (`mapDbError`), in case a future caller, a long-running competing
 * transaction, or a bug elsewhere still manages to trigger one.
 */
import type { Prisma } from "@/generated/prisma/client";

interface LockRow {
  id: string;
  es_admin_activo: boolean;
}

export interface LockUsuarioYAdministradoresActivosResult {
  /** `true` iff a row matching `usuarioId` (in this tenant) was found and locked -- callers still do their own `loadUsuarioParaAccion` (NOT FOUND vs. hidden/técnico) after this. */
  targetLocked: boolean;
  /** ids of every currently-ACTIVO ADMINISTRADOR in `tenantId`, read with a FRESH statement AFTER the lock wait (not from the locked snapshot -- see the comment inside the function). */
  idsAdminsActivos: string[];
}

/**
 * Locks (`SELECT ... FOR UPDATE OF u`, single ordered statement -- see the
 * module doc comment's LOCK ORDER section) the usuario `usuarioId` AND
 * every currently-ACTIVO ADMINISTRADOR of `tenantId`, for the lifetime of
 * `tx`. Callers must run their `loadUsuarioParaAccion` (or equivalent)
 * read for the target AFTER this returns -- at that point the row is
 * already locked by this transaction, so the read reflects the true
 * current state (any concurrent writer is blocked until this transaction
 * commits or rolls back), fixing the "audit row records a false 'before'
 * state" defect (M3).
 */
export async function lockUsuarioYAdministradoresActivos(
  tx: Prisma.TransactionClient,
  tenantId: string,
  usuarioId: string,
): Promise<LockUsuarioYAdministradoresActivosResult> {
  const rows = await tx.$queryRaw<LockRow[]>`
    SELECT u.id,
           (u.estado = 'ACTIVO' AND EXISTS (
             SELECT 1 FROM fsj.usuario_rol ur
             JOIN fsj.rol r ON r.id = ur.rol_id
             WHERE ur.usuario_id = u.id AND ur.tenant_id = u.tenant_id AND r.codigo = 'ADMINISTRADOR'
           )) AS es_admin_activo
    FROM fsj.usuario u
    WHERE u.tenant_id = ${tenantId}::uuid
      AND (
        u.id = ${usuarioId}::uuid
        OR (u.estado = 'ACTIVO' AND EXISTS (
          SELECT 1 FROM fsj.usuario_rol ur
          JOIN fsj.rol r ON r.id = ur.rol_id
          WHERE ur.usuario_id = u.id AND ur.tenant_id = u.tenant_id AND r.codigo = 'ADMINISTRADOR'
        ))
      )
    ORDER BY u.id
    FOR UPDATE OF u
  `;
  // The locked statement above SERIALIZES concurrent admin actions, but its
  // `es_admin_activo` column must NOT be trusted for the decision: admin
  // status lives in `usuario_rol`, which is not locked. If a concurrent
  // transaction removed someone's ADMINISTRADOR role (a change to usuario_rol
  // only -- the usuario row is untouched), Postgres does not re-evaluate the
  // EXISTS predicate for that row after the wait, so the locked result would
  // still count them as an admin. Two admins stripping each other's role at
  // the same time could then both pass and leave zero admins.
  // A NEW statement under READ COMMITTED takes a fresh snapshot AFTER the
  // lock wait, so it sees everything the transaction we waited on committed.
  const adminRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT u.id
    FROM fsj.usuario u
    WHERE u.tenant_id = ${tenantId}::uuid
      AND u.estado = 'ACTIVO'
      AND EXISTS (
        SELECT 1 FROM fsj.usuario_rol ur
        JOIN fsj.rol r ON r.id = ur.rol_id
        WHERE ur.usuario_id = u.id AND ur.tenant_id = u.tenant_id AND r.codigo = 'ADMINISTRADOR'
      )
    ORDER BY u.id
  `;
  return {
    targetLocked: rows.some((row) => row.id === usuarioId),
    idsAdminsActivos: adminRows.map((row) => row.id),
  };
}
