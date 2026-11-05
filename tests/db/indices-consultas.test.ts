/**
 * DB tests for migration 0121_indices_consultas (security audit P1-10).
 *
 * Migration 0121 adds indexes covering composite foreign keys (tenant_id, x_id)
 * and partial indexes for hot queries (e.g. pending asientos, active sessions).
 *
 * An index impacts query planning and execution performance rather than business
 * outcomes, so this suite verifies that all nine indexes exist in the `fsj` schema
 * with their expected column orders and partial WHERE predicates.
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner } from "./helpers";

const EXPECTED_INDEXES = [
  "idx_asiento_contralor_pendientes",
  "idx_asiento_recetario_pendientes",
  "idx_asiento_recetario_tenant_fecha",
  "idx_elaboracion_lote_formula",
  "idx_movimiento_stock_linea_pesaje",
  "idx_movimiento_stock_preparacion",
  "idx_receta_tenant_lote_archivo",
  "idx_receta_tenant_medico",
  "idx_sesion_usuario_activas",
] as const;

describe.skipIf(dbTestSkipReason() !== null)("0121_indices_consultas migration (fsj schema)", () => {
  it("has the nine migration 0121 indexes with the right shape and partial predicates", async () => {
    await asOwner(async (client) => {
      const result = await client.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = 'fsj'
           AND indexname IN (
             'idx_asiento_contralor_pendientes',
             'idx_asiento_recetario_pendientes',
             'idx_asiento_recetario_tenant_fecha',
             'idx_elaboracion_lote_formula',
             'idx_movimiento_stock_linea_pesaje',
             'idx_movimiento_stock_preparacion',
             'idx_receta_tenant_lote_archivo',
             'idx_receta_tenant_medico',
             'idx_sesion_usuario_activas'
           )
         ORDER BY indexname`,
      );

      const foundNames = result.rows.map((r) => r.indexname);
      expect(foundNames).toEqual([...EXPECTED_INDEXES].sort());

      const byName = new Map(result.rows.map((r) => [r.indexname, r.indexdef]));

      // 1. idx_asiento_contralor_pendientes (tenant_id, fecha_asiento) WHERE contains "estado = 'VIGENTE'" and "cierre_diario_id IS NULL"
      const contralorPendientes = byName.get("idx_asiento_contralor_pendientes")!;
      expect(contralorPendientes).toContain("(tenant_id, fecha_asiento)");
      expect(contralorPendientes).toContain("estado = 'VIGENTE'");
      expect(contralorPendientes).toContain("cierre_diario_id IS NULL");

      // 2. idx_asiento_recetario_pendientes (tenant_id, fecha_asiento) WHERE contains "estado = 'VIGENTE'" and "cierre_diario_id IS NULL"
      const recetarioPendientes = byName.get("idx_asiento_recetario_pendientes")!;
      expect(recetarioPendientes).toContain("(tenant_id, fecha_asiento)");
      expect(recetarioPendientes).toContain("estado = 'VIGENTE'");
      expect(recetarioPendientes).toContain("cierre_diario_id IS NULL");

      // 3. idx_asiento_recetario_tenant_fecha (tenant_id, fecha_asiento), no WHERE
      const recetarioFecha = byName.get("idx_asiento_recetario_tenant_fecha")!;
      expect(recetarioFecha).toContain("(tenant_id, fecha_asiento)");
      expect(recetarioFecha).not.toContain(" WHERE ");

      // 4. idx_elaboracion_lote_formula (tenant_id, formula_id) WHERE "formula_id IS NOT NULL"
      const elabFormula = byName.get("idx_elaboracion_lote_formula")!;
      expect(elabFormula).toContain("(tenant_id, formula_id)");
      expect(elabFormula).toContain("formula_id IS NOT NULL");

      // 5. idx_movimiento_stock_linea_pesaje (tenant_id, linea_pesaje_id) WHERE "linea_pesaje_id IS NOT NULL"
      const movLinea = byName.get("idx_movimiento_stock_linea_pesaje")!;
      expect(movLinea).toContain("(tenant_id, linea_pesaje_id)");
      expect(movLinea).toContain("linea_pesaje_id IS NOT NULL");

      // 6. idx_movimiento_stock_preparacion (tenant_id, preparacion_id) WHERE "preparacion_id IS NOT NULL"
      const movPrep = byName.get("idx_movimiento_stock_preparacion")!;
      expect(movPrep).toContain("(tenant_id, preparacion_id)");
      expect(movPrep).toContain("preparacion_id IS NOT NULL");

      // 7. idx_receta_tenant_lote_archivo (tenant_id, lote_archivo_id), no WHERE
      const recetaLote = byName.get("idx_receta_tenant_lote_archivo")!;
      expect(recetaLote).toContain("(tenant_id, lote_archivo_id)");
      expect(recetaLote).not.toContain(" WHERE ");

      // 8. idx_receta_tenant_medico (tenant_id, medico_id), no WHERE
      const recetaMedico = byName.get("idx_receta_tenant_medico")!;
      expect(recetaMedico).toContain("(tenant_id, medico_id)");
      expect(recetaMedico).not.toContain(" WHERE ");

      // 9. idx_sesion_usuario_activas (tenant_id, usuario_id) WHERE "revocada_en IS NULL"
      const sesionActivas = byName.get("idx_sesion_usuario_activas")!;
      expect(sesionActivas).toContain("(tenant_id, usuario_id)");
      expect(sesionActivas).toContain("revocada_en IS NULL");
    });
  });
});
