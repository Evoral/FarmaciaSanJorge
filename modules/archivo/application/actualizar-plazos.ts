/**
 * FASE 12 point 12.2 (M15): "Actualizar plazos" -- shared core
 * (`moverPlazoCumplidoTenant`, in the repository) moves every `EN_ARCHIVO`
 * lote whose vencimiento (`periodo_hasta` + N años, N per
 * `incluye_controladas`, DP-26 PARCIAL) is `<= fsj.jornada_actual(tenant)`
 * to `PLAZO_CUMPLIDO`. Two callers:
 *
 *   1. `actualizarPlazos` -- the DT's own "Actualizar plazos" button on
 *      `/archivo` (session-driven, `archivo.lotes.gestionar`, normal
 *      `defineCommand`).
 *   2. `runActualizarPlazosJob` -- the daily job
 *      (`app/api/jobs/plazos-archivo/route.ts`, secret-header protected).
 *      This one has NO authenticated session at all -- it iterates EVERY
 *      active tenant itself, auditing each move as that tenant's own
 *      SISTEMA usuario. It is therefore the ONE place in `modules/archivo`
 *      allowed to open `withPlatformTransaction`/`withTenantTransaction`
 *      directly (see eslint.config.mjs's ignore for this exact file path) --
 *      the same structural exemption `modules/auth/**` has for login/session
 *      validation, which also legitimately runs before any session exists.
 *      Idempotent (only ever matches `EN_ARCHIVO` rows) and isolates
 *      failures per tenant so one broken tenant never stops the rest.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { withPlatformTransaction, withTenantTransaction } from "@/shared/db/transaction";
import { getLogger } from "@/shared/logging/logger";
import { listActiveTenantIds, getSistemaUsuarioId, moverPlazoCumplidoTenant, type LoteMovidoAPlazoCumplido } from "../infrastructure/archivo-repository";

export interface ActualizarPlazosOutput {
  cantidad: number;
  lotes: LoteMovidoAPlazoCumplido[];
}

export const actualizarPlazosCommand = defineCommand({
  name: "archivo.lotes.actualizarPlazos",
  permiso: "archivo.lotes.gestionar",
  input: z.object({}),
  audit: {
    skip: true,
    reason: "moverPlazoCumplidoTenant audits each moved lote individually (0..N rows, not a single entidadId) inside its own auditRecord calls -- see the repository function's doc comment.",
  },
  handler: async ({ tx, session }) => {
    const lotes = await moverPlazoCumplidoTenant(tx, session.tenantId, session.usuario.id, "Actualización manual de plazos de archivo (botón «Actualizar plazos»).");
    const output: ActualizarPlazosOutput = { cantidad: lotes.length, lotes };
    return { output };
  },
});

export async function actualizarPlazos(): Promise<ActualizarPlazosOutput> {
  return actualizarPlazosCommand.execute({});
}

// ============================================================================
// Daily job -- no session, iterates every active tenant. See module doc
// comment for why this function (and only this function) is allowed to open
// transactions directly.
// ============================================================================

export interface ResultadoJobTenant {
  tenantId: string;
  lotesMovidos: number;
  ok: boolean;
}

export interface ResultadoJob {
  tenantsProcesados: number;
  lotesMovidos: number;
  tenantsConError: number;
  detalle: ResultadoJobTenant[];
}

export async function runActualizarPlazosJob(): Promise<ResultadoJob> {
  const tenantIds = await withPlatformTransaction((tx) => listActiveTenantIds(tx));

  const detalle: ResultadoJobTenant[] = [];
  for (const tenantId of tenantIds) {
    try {
      const lotesMovidos = await withTenantTransaction(tenantId, async (tx) => {
        const sistemaId = await getSistemaUsuarioId(tx, tenantId);
        if (!sistemaId) {
          throw new Error(`No hay usuario SISTEMA para el tenant ${tenantId}`);
        }
        const lotes = await moverPlazoCumplidoTenant(tx, tenantId, sistemaId, "Proceso automático de plazos");
        return lotes.length;
      });
      detalle.push({ tenantId, lotesMovidos, ok: true });
    } catch (error) {
      // Per-tenant failure must never stop the rest (task's explicit rule).
      getLogger().error({ error, tenantId }, "plazos-archivo: job failed for tenant");
      detalle.push({ tenantId, lotesMovidos: 0, ok: false });
    }
  }

  return {
    tenantsProcesados: tenantIds.length,
    lotesMovidos: detalle.reduce((sum, d) => sum + d.lotesMovidos, 0),
    tenantsConError: detalle.filter((d) => !d.ok).length,
    detalle,
  };
}
