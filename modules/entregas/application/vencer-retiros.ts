/**
 * Daily job "retiro vencido" (docs/specs/retiro-vencido.md RV1-RV3, RV10): moves every PREPARADA receta whose retiro
 * expired to RETIRO_VENCIDO. Called by `app/api/jobs/retiros-vencidos/route.ts` (secret-header protected).
 *
 * There is NO authenticated session here: the job iterates EVERY active tenant itself and audits each move as that
 * tenant's own SISTEMA usuario. That is why `runVencerRetirosJob` is, like `runActualizarPlazosJob`
 * (`modules/archivo/application/actualizar-plazos.ts`), allowed to open `withPlatformTransaction` /
 * `withTenantTransaction` directly (see the exemption in eslint.config.mjs for this exact file path).
 *
 * - Idempotent: it only ever matches PREPARADA recetas, so a second run the same day finds nothing (RV2).
 * - One transaction per tenant; a failing tenant rolls back alone and never stops the rest.
 * - `dias_retiro_vencido` is read on every run (RV10): changing it never recalculates anything on the spot, the next run
 *   uses the new value. 0 = disabled, the tenant is skipped.
 * - "Today" is the tenant's jornada as the DB reports it (`fsj.jornada_actual`), turned into a cutoff instant by the pure
 *   domain function `instanteCorteRetiroVencido`; the SQL only compares `preparada_en < corte`.
 */
import { withPlatformTransaction, withTenantTransaction } from "@/shared/db/transaction";
import { getLogger } from "@/shared/logging/logger";
import { instanteCorteRetiroVencido, retiroVencidoDesactivado } from "../domain/retiro-vencido";
import { getDiasRetiroVencido, jornadaActualTenant, zonaHorariaTenant } from "../infrastructure/entrega-repository";
import { getSistemaUsuarioId, listActiveTenantIds, lockRecetasPreparadasVencidas, marcarRetiroVencido } from "../infrastructure/retiro-vencido-repository";

export interface ResultadoVencerRetirosTenant {
  tenantId: string;
  /** Recetas moved to RETIRO_VENCIDO in this run. */
  vencidas: number;
  /** True when the tenant has `dias_retiro_vencido` = 0, so nothing was evaluated. */
  desactivado: boolean;
  /** Set only when the tenant's run failed (and rolled back). */
  error?: string;
}

export interface ResultadoVencerRetiros {
  tenantsProcesados: number;
  recetasVencidas: number;
  tenantsConError: number;
  detalle: ResultadoVencerRetirosTenant[];
}

export async function runVencerRetirosJob(): Promise<ResultadoVencerRetiros> {
  const tenantIds = await withPlatformTransaction((tx) => listActiveTenantIds(tx));

  const detalle: ResultadoVencerRetirosTenant[] = [];
  for (const tenantId of tenantIds) {
    try {
      const resultado = await withTenantTransaction(tenantId, async (tx): Promise<{ vencidas: number; desactivado: boolean }> => {
        const dias = await getDiasRetiroVencido(tx, tenantId);
        if (retiroVencidoDesactivado(dias)) return { vencidas: 0, desactivado: true };

        const sistemaId = await getSistemaUsuarioId(tx, tenantId);
        if (!sistemaId) throw new Error(`No hay usuario SISTEMA para el tenant ${tenantId}`);

        const corte = instanteCorteRetiroVencido(await jornadaActualTenant(tx, tenantId), dias, await zonaHorariaTenant(tx, tenantId));
        if (!corte) return { vencidas: 0, desactivado: true };

        const recetas = await lockRecetasPreparadasVencidas(tx, tenantId, corte);
        const vencidas = await marcarRetiroVencido(tx, { tenantId, sistemaId, recetas, diasRetiroVencido: dias });
        return { vencidas, desactivado: false };
      });
      detalle.push({ tenantId, ...resultado });
    } catch (error) {
      // A tenant's failure must never stop the rest.
      getLogger().error({ error, tenantId }, "retiros-vencidos: job failed for tenant");
      detalle.push({ tenantId, vencidas: 0, desactivado: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    tenantsProcesados: tenantIds.length,
    recetasVencidas: detalle.reduce((sum, d) => sum + d.vencidas, 0),
    tenantsConError: detalle.filter((d) => d.error !== undefined).length,
    detalle,
  };
}
