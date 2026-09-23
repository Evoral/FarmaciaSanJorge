/**
 * DB tests for FASE 4 points 4.1-4.2 (unidades/drogas) additions that
 * tests/db/unidades-medida.test.ts and tests/db/catalogos-negocio.test.ts
 * do NOT already cover, plus migration 0027 (proveedor.motivo_baja) which
 * postdates both those files. Read first -- do not duplicate what they
 * already assert (INV-M01..M04, droga_es_controlada_check, name/cuit/matricula
 * uniqueness, forbid_delete, cross-tenant isolation).
 *
 * What THIS file adds, and why the app relies on it:
 *   1. migration 0027: fsj.proveedor.motivo_baja exists and fsj_app can
 *      UPDATE it (dar-de-baja-proveedor.ts / reactivar-proveedor.ts write it
 *      every time).
 *   2. "reactivación" (fecha_baja/motivo_baja -> NULL) is actually possible
 *      as fsj_app for all three FASE 4 catalogs -- the existing tests only
 *      ever exercise baja (setting fecha_baja), never clearing it back.
 *      reactivar-unidad.ts/reactivar-droga.ts/reactivar-proveedor.ts all
 *      depend on this grant shape.
 *   3. droga's trg_droga_marcar_unidad_usada also fires on UPDATE OF
 *      unidad_base_id (not just INSERT) -- editar-droga.ts allows changing
 *      unidadBaseId while the droga has no partidas (DP-12), and depends on
 *      the NEW unit being marked usada too. Only the INSERT path is tested
 *      in tests/db/catalogos-negocio.test.ts.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectDbRejection } from "./helpers";

async function insertTenant(tx: Client, suffix: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

async function insertUnidad(tx: Client, suffix: string): Promise<string> {
  const codigo = `TEST-UM-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const result = await tx.query(
    `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
     VALUES ($1, $1, 'x', 'MASA', 1, false) RETURNING id`,
    [codigo],
  );
  return result.rows[0].id as string;
}

async function insertDroga(tx: Client, tenantId: string, unidadId: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id) VALUES ($1, $2, $3) RETURNING id`, [
    tenantId,
    `Droga-${randomUUID()}`,
    unidadId,
  ]);
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("FASE 4 (4.1/4.2) additions to migrations 0006/0007/0027", () => {
  it("migration 0027: fsj.proveedor has a motivo_baja column", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const columns = await tx.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'fsj' AND table_name = 'proveedor'`,
        );
        const names = columns.rows.map((r) => r.column_name as string);
        expect(names).toContain("motivo_baja");
      }),
    );
  });

  it("proveedor: fsj_app can set fecha_baja + motivo_baja (baja) and clear both back to NULL (reactivación)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "prov-motivo");
        const row = await tx.query(
          `INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'X', '20111111119') RETURNING id`,
          [tenantId],
        );
        const proveedorId = row.rows[0].id as string;

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

        await tx.query(`UPDATE fsj.proveedor SET fecha_baja = now(), motivo_baja = 'Cerró el negocio' WHERE id = $1`, [proveedorId]);
        const afterBaja = await tx.query(`SELECT fecha_baja, motivo_baja FROM fsj.proveedor WHERE id = $1`, [proveedorId]);
        expect(afterBaja.rows[0].fecha_baja).not.toBeNull();
        expect(afterBaja.rows[0].motivo_baja).toBe("Cerró el negocio");

        await tx.query(`UPDATE fsj.proveedor SET fecha_baja = NULL, motivo_baja = NULL WHERE id = $1`, [proveedorId]);
        const afterReactivacion = await tx.query(`SELECT fecha_baja, motivo_baja FROM fsj.proveedor WHERE id = $1`, [proveedorId]);
        expect(afterReactivacion.rows[0].fecha_baja).toBeNull();
        expect(afterReactivacion.rows[0].motivo_baja).toBeNull();
      }),
    );
  });

  it("unidad_medida: fsj_app can reactivate (clear fecha_baja/motivo_baja) a unit given de baja", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const unidadId = await insertUnidad(tx, "react");
        await tx.query(`UPDATE fsj.unidad_medida SET fecha_baja = now(), motivo_baja = 'en desuso' WHERE id = $1`, [unidadId]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query(`UPDATE fsj.unidad_medida SET fecha_baja = NULL, motivo_baja = NULL WHERE id = $1`, [unidadId]);

        await tx.query("RESET ROLE");
        const after = await tx.query(`SELECT fecha_baja, motivo_baja FROM fsj.unidad_medida WHERE id = $1`, [unidadId]);
        expect(after.rows[0].fecha_baja).toBeNull();
        expect(after.rows[0].motivo_baja).toBeNull();
      }),
    );
  });

  it("droga: fsj_app can reactivate (clear fecha_baja/motivo_baja) a droga given de baja", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg-react");
        const unidadId = await insertUnidad(tx, "drg-react");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        await tx.query(`UPDATE fsj.droga SET fecha_baja = now(), motivo_baja = 'descontinuada' WHERE id = $1`, [drogaId]);

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await tx.query(`UPDATE fsj.droga SET fecha_baja = NULL, motivo_baja = NULL WHERE id = $1`, [drogaId]);

        await tx.query("RESET ROLE");
        const after = await tx.query(`SELECT fecha_baja, motivo_baja FROM fsj.droga WHERE id = $1`, [drogaId]);
        expect(after.rows[0].fecha_baja).toBeNull();
        expect(after.rows[0].motivo_baja).toBeNull();
      }),
    );
  });

  it("droga: changing unidad_base_id (UPDATE, not just INSERT) marks the NEW unidad_medida as usada", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg-upd-unidad");
        const unidadOriginal = await insertUnidad(tx, "drg-upd-orig");
        const unidadNueva = await insertUnidad(tx, "drg-upd-nueva");
        const drogaId = await insertDroga(tx, tenantId, unidadOriginal);

        const antes = await tx.query(`SELECT usada FROM fsj.unidad_medida WHERE id = $1`, [unidadNueva]);
        expect(antes.rows[0].usada).toBe(false);

        await tx.query(`UPDATE fsj.droga SET unidad_base_id = $1 WHERE id = $2`, [unidadNueva, drogaId]);

        const despues = await tx.query(`SELECT usada FROM fsj.unidad_medida WHERE id = $1`, [unidadNueva]);
        expect(despues.rows[0].usada).toBe(true);
      }),
    );
  });

  it("proveedor: motivo_baja is not grant-updatable by fsj_app for a column outside the grant list (sanity check on the grant shape)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "prov-grant");
        const row = await tx.query(
          `INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'X', '20111111119') RETURNING id`,
          [tenantId],
        );
        const proveedorId = row.rows[0].id as string;

        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        // tenant_id itself is NEVER grant-updatable for any business table (INV-T03) -- confirms motivo_baja's grant is additive, not a broad "all columns" grant.
        await expectDbRejection(tx, () => tx.query(`UPDATE fsj.proveedor SET tenant_id = $1 WHERE id = $2`, [randomUUID(), proveedorId]), "42501");
      }),
    );
  });
});
