/**
 * D2 ORIGINAL (user decision, 2026-09-23) anulled/rectified the WHOLE
 * receta as soon as ONE of its asientos was anulled/rectified. D2 REVISED
 * (user decision, 2026-09-23, same day -- supersedes the paragraph above):
 * the libro recetario is registered and corrected PER ITEM. A receta can
 * have SEVERAL `item_receta`, each with its own `preparacion` and (once
 * confirmed) its own SISTEMA `asiento_recetario`; anulling/rectifying ONE
 * asiento now affects ONLY that item. The receta itself moves to `ANULADA`
 * ONLY when, after this operation, EVERY item of the receta is "sin
 * efecto" -- see `todosLosItemsSinEfecto` below for exactly what that
 * means. If any item is still pending preparación (no CONFIRMADA
 * preparación yet) or has a VIGENTE asiento with no rectificativo, the
 * receta's estado is left UNCHANGED (not anulled) -- the asiento-side
 * operation (the caller's own INSERT, already done before this function
 * runs) still proceeds regardless.
 *
 * If the receta is ENTREGADA (a terminal estado), it is intentionally left
 * alone (unchanged D2 rule: "la receta stays ENTREGADA"; the asiento
 * operation still proceeds -- this function simply returns `null` before
 * even computing the per-item check).
 *
 * WHY THIS LIVES HERE, NOT IN modules/recetas: `modules/recetas/application/anular-receta.ts`'s
 * `defineCommand` opens its OWN `withTenantTransaction` and calls
 * `requireSession()` (cookie-backed) -- it cannot be invoked from INSIDE an
 * already-open transaction (this one), so reusing it is not viable. Writing
 * `tx.receta` directly from this module's infrastructure/ layer instead
 * follows the SAME precedent `preparacion-repository.ts#updateRecetaEstado`
 * already set (a different module writing fsj.receta straight through the
 * shared Prisma client) -- eslint's `domainBoundaryPatterns`/`appBoundaryPatterns`
 * (eslint.config.mjs) only forbid importing ANOTHER module's
 * `infrastructure/` *file*, never touching its table via `tx.<model>`.
 * `ESTADOS_TERMINALES` is duplicated (not imported from
 * `modules/recetas/domain/receta.ts`) to dodge a TS nominal-enum mismatch
 * between that module's own plain-string-union `EstadoReceta` and the
 * generated Prisma enum this file's `tx.receta.estado` actually has --
 * keep the two in sync if either ever changes (they mirror
 * `docs/specs/libro-recetario-y-contralor.md` / migration 0011's
 * `fsj.receta_validar_transicion_estado`).
 *
 * PER-ITEM CHECK, COMPUTED IN THE SAME TRANSACTION: the caller
 * (anular-asiento.ts / rectificar-asiento.ts) always calls this function
 * AFTER its own asiento-side INSERT (the anulacion_asiento row, or the
 * RECTIFICATIVO asiento_recetario row) in the SAME transaction -- so the
 * DB's own AFTER INSERT trigger has already flipped the just-anulled
 * asiento's `estado` to `ANULADO` (INV-L09), and a just-inserted
 * RECTIFICATIVO row is already visible to a query in this same tx. This is
 * why `todosLosItemsSinEfecto` below can just query fresh state instead of
 * accounting for the current operation specially.
 *
 * NO MIGRATION ADDED: `item_receta` has no per-item `estado` column (see
 * `prisma/schema.prisma`'s `ItemReceta` model) -- "sin efecto" is derived
 * on the fly from `preparacion`/`asiento_recetario`, never stored. FASE 11
 * (entrega) must exclude items whose asiento is "sin efecto" from what
 * gets delivered -- see the one-line note added to
 * `docs/plan-implementacion.md` under FASE 11.
 */
import type { Prisma } from "@/generated/prisma/client";
import { TipoAccion, record as auditRecord } from "@/shared/audit";

/** Mirrors modules/recetas/domain/receta.ts#ESTADOS_TERMINALES -- see module doc comment for why this is a local copy, not an import. */
const ESTADOS_TERMINALES_RECETA: ReadonlySet<string> = new Set(["ENTREGADA", "ANULADA"]);

export interface DesvincularRecetaInput {
  tenantId: string;
  /** The asiento's OWN preparacionId (SISTEMA asientos), or the ORIGINAL asiento's preparacionId when called for a RECTIFICATIVO (which itself has no preparacionId). `null` is accepted as a no-op for callers that have no preparacion to resolve. */
  preparacionId: string | null;
  /** The asiento_recetario's own numeroCorrelativo -- used to build the motivoAnulacion text ("Todos los ítems quedaron sin efecto (último: asiento Nº X): <motivo>"). */
  numeroCorrelativo: string;
  motivo: string;
  usuarioId: string;
}

export interface RecetaDesvinculada {
  recetaId: string;
  estadoAnterior: string;
}

/** Resolves the receta reached from a preparacionId, LOCKING it `FOR UPDATE` first (M3 discipline). Returns `null` if the preparacion/item/receta chain cannot be resolved. */
async function lockRecetaDeAsiento(
  tx: Prisma.TransactionClient,
  tenantId: string,
  preparacionId: string,
): Promise<{ id: string; estado: string } | null> {
  const preparacion = await tx.preparacion.findUnique({ where: { id: preparacionId, tenantId }, select: { itemRecetaId: true } });
  if (!preparacion) return null;

  const item = await tx.itemReceta.findUnique({ where: { id: preparacion.itemRecetaId, tenantId }, select: { recetaId: true } });
  if (!item) return null;

  await tx.$queryRaw`SELECT id FROM fsj.receta WHERE id = ${item.recetaId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;

  return tx.receta.findUnique({ where: { id: item.recetaId, tenantId }, select: { id: true, estado: true } });
}

/**
 * `true` when the receta has AT LEAST ONE `item_receta` and EVERY one of
 * them is "sin efecto": its `preparacion` reached CONFIRMADA AND its
 * SISTEMA `asiento_recetario` is either `ANULADO` or already has a
 * RECTIFICATIVO. An item that never got a CONFIRMADA preparación (still
 * pending) or whose asiento is VIGENTE with no rectificativo yet is NOT
 * "sin efecto", and blocks the whole receta from transitioning (per-item,
 * not all-or-nothing on JUST the asiento this call is reacting to -- every
 * sibling item is re-checked fresh, in this SAME transaction).
 *
 * Raw SQL, same convention as
 * `modules/preparaciones/infrastructure/preparacion-repository.ts#todosLosItemsConfirmados`
 * (no Prisma back-relation from `item_receta` to `preparacion`, and none
 * from `preparacion` to `asiento_recetario` either -- both are plain FK
 * columns, joined here directly).
 */
async function todosLosItemsSinEfecto(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ total: number; sin_efecto: number }[]>`
    SELECT
      (SELECT count(*)::int FROM fsj.item_receta WHERE tenant_id = ${tenantId}::uuid AND receta_id = ${recetaId}::uuid) AS total,
      (
        SELECT count(DISTINCT ir.id)::int
        FROM fsj.item_receta ir
        JOIN fsj.preparacion p ON p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'CONFIRMADA'
        JOIN fsj.asiento_recetario a ON a.tenant_id = p.tenant_id AND a.preparacion_id = p.id AND a.origen = 'SISTEMA'
        WHERE ir.tenant_id = ${tenantId}::uuid AND ir.receta_id = ${recetaId}::uuid
          AND (
            a.estado = 'ANULADO'
            OR EXISTS (
              SELECT 1 FROM fsj.asiento_recetario r
              WHERE r.tenant_id = a.tenant_id AND r.asiento_original_id = a.id
            )
          )
      ) AS sin_efecto
  `;
  const row = rows[0];
  if (!row) return false;
  return row.total > 0 && row.total === row.sin_efecto;
}

/**
 * Sets the receta to ANULADA (with a `motivoAnulacion` referencing the
 * asiento) and writes ONE extra audit row for it, ONLY when EVERY item of
 * the receta is "sin efecto" (see `todosLosItemsSinEfecto`) AND the receta
 * is not already in a terminal estado (ENTREGADA/ANULADA). Otherwise
 * (terminal receta, or at least one item still pending/vigente) nothing is
 * written and this returns `null`. Callers (anularAsiento / rectificarAsiento)
 * call this AFTER their own asiento-side write, in the SAME transaction,
 * and simply ignore a `null` result (nothing to couple).
 */
export async function desvincularRecetaPorAsiento(tx: Prisma.TransactionClient, input: DesvincularRecetaInput): Promise<RecetaDesvinculada | null> {
  if (!input.preparacionId) return null;

  const receta = await lockRecetaDeAsiento(tx, input.tenantId, input.preparacionId);
  if (!receta) return null;
  if (ESTADOS_TERMINALES_RECETA.has(receta.estado)) return null;

  const todosSinEfecto = await todosLosItemsSinEfecto(tx, input.tenantId, receta.id);
  if (!todosSinEfecto) return null;

  const motivoAnulacion = `Todos los ítems quedaron sin efecto (último: asiento Nº ${input.numeroCorrelativo}): ${input.motivo}`;

  await tx.receta.update({ where: { id: receta.id, tenantId: input.tenantId }, data: { estado: "ANULADA", motivoAnulacion } });

  await auditRecord(tx, {
    tenantId: input.tenantId,
    usuarioId: input.usuarioId,
    entidad: "receta",
    entidadId: receta.id,
    accion: TipoAccion.ANULAR,
    motivo: motivoAnulacion,
    valorAnterior: { estado: receta.estado },
    valorNuevo: { estado: "ANULADA" },
  });

  return { recetaId: receta.id, estadoAnterior: receta.estado };
}
