/**
 * Prisma/raw-SQL access for the daily "retiro vencido" job (docs/specs/retiro-vencido.md RV1-RV3). Every function runs
 * inside an ALREADY OPEN tenant transaction (the job opens one per tenant, see `application/vencer-retiros.ts`).
 *
 * `modules/entregas` cannot reach into `modules/archivo/infrastructure`, so the two tenant helpers the job shares with
 * the plazos job (`listActiveTenantIds`, `getSistemaUsuarioId`) are OWN COPIES, same "own copy per module" discipline as
 * `entrega-repository.ts`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { record as auditRecord, TipoAccion } from "@/shared/audit";

/** Every active tenant (`fecha_baja IS NULL`). Run it inside `withPlatformTransaction`: `fsj.tenant` is a global table. */
export async function listActiveTenantIds(tx: Prisma.TransactionClient): Promise<string[]> {
  const rows = await tx.tenant.findMany({ where: { fechaBaja: null }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** The tenant's SISTEMA usuario (seeded by scripts/create-tenant.ts, `es_tecnico = true`): the actor of the job's audit rows. */
export async function getSistemaUsuarioId(tx: Prisma.TransactionClient, tenantId: string): Promise<string | null> {
  const row = await tx.usuario.findFirst({ where: { tenantId, esTecnico: true }, select: { id: true } });
  return row?.id ?? null;
}

export interface RecetaPorVencer {
  id: string;
  preparadaEn: Date;
}

/**
 * Selects AND locks the PREPARADA recetas whose retiro expired (`preparada_en < corte`, the cutoff computed in TypeScript
 * by `instanteCorteRetiroVencido` so the rule lives in one place).
 *
 * Lock strategy: `FOR UPDATE SKIP LOCKED` ordered by id.
 *  - A receta somebody is working on right now (`registrarEntrega`, `anularEntrega`, `confirmarFirmaRecibida`... all take
 *    `lockRecetaParaAccion`, a plain `FOR UPDATE` on the receta row) is skipped instead of waited for: the job never
 *    blocks the mostrador and cannot form a wait cycle with it. A skipped receta is not lost: it is still PREPARADA and
 *    the next run picks it up (RV2: the rule looks at the date, not at "yesterday"). If the user's transaction was
 *    about to pick the receta up, it stays PREPARADA and nothing expired under their hands.
 *  - The `ORDER BY id` gives every multi-row lock taker the same order, so two concurrent job runs never deadlock.
 *  - The `estado = 'PREPARADA'` predicate is re-evaluated by Postgres on the locked row version (READ COMMITTED), so a
 *    receta delivered or annulled between the snapshot and the lock is not returned.
 * `fsj_app` can take this lock because `fsj.receta` has UPDATE grants (migrations 0011/0016/0040), same as
 * `lockRecetaParaAccion`.
 */
export async function lockRecetasPreparadasVencidas(tx: Prisma.TransactionClient, tenantId: string, corte: Date): Promise<RecetaPorVencer[]> {
  const rows = await tx.$queryRaw<{ id: string; preparada_en: Date }[]>`
    SELECT id, preparada_en
    FROM fsj.receta
    WHERE tenant_id = ${tenantId}::uuid
      AND estado = 'PREPARADA'
      AND preparada_en IS NOT NULL
      AND preparada_en < ${corte}::timestamptz
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  `;
  return rows.map((r) => ({ id: r.id, preparadaEn: r.preparada_en }));
}

/**
 * PREPARADA -> RETIRO_VENCIDO for the given (already locked) recetas, then one `CAMBIAR_ESTADO` audit row per receta as the
 * tenant's SISTEMA usuario (RV3). INV-R08 (migration 0095) validates the transition; `preparada_en` is untouched (the
 * trigger only fires on entering PREPARADA). Returns how many recetas moved.
 */
export async function marcarRetiroVencido(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; sistemaId: string; recetas: RecetaPorVencer[]; diasRetiroVencido: number },
): Promise<number> {
  if (input.recetas.length === 0) return 0;
  const { count } = await tx.receta.updateMany({
    where: { tenantId: input.tenantId, id: { in: input.recetas.map((r) => r.id) }, estado: "PREPARADA" },
    data: { estado: "RETIRO_VENCIDO" },
  });
  // The rows are locked and were just read as PREPARADA: anything else is a bug, and the whole tenant's run rolls back.
  if (count !== input.recetas.length) {
    throw new Error(`marcarRetiroVencido: expected to move ${input.recetas.length} recetas, moved ${count}`);
  }
  for (const receta of input.recetas) {
    await auditRecord(tx, {
      tenantId: input.tenantId,
      usuarioId: input.sistemaId,
      entidad: "receta",
      entidadId: receta.id,
      accion: TipoAccion.CAMBIAR_ESTADO,
      valorAnterior: { estado: "PREPARADA" },
      valorNuevo: { estado: "RETIRO_VENCIDO" },
      motivo: "Proceso automático de retiro vencido",
      contexto: { origen: "vencer-retiros", diasRetiroVencido: input.diasRetiroVencido, preparadaEn: receta.preparadaEn.toISOString() },
    });
  }
  return count;
}
