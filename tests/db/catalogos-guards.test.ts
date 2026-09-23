/**
 * DB tests for migration 0028 (FASE 4 review findings B1/M1/M2/m1 -- see
 * that migration's header for the full write-up of each fix). Read
 * tests/db/catalogos-fase4.test.ts first -- do not duplicate what it
 * already covers (migration 0027's motivo_baja column/grant, reactivación
 * being possible as fsj_app, droga's unidad-usada trigger firing on UPDATE).
 *
 * Every test here is written to FAIL against the pre-0028 schema:
 *   - B1: the old CHECK (`^[0-9]{2}-?[0-9]{8}-?[0-9]$`) accepted a dashed
 *     cuit; the new one (`^[0-9]{11}$`) rejects it.
 *   - M1/M2: DP-12 used to be [APP]-only -- nothing in the DB rejected an
 *     UPDATE of es_controlada/tipo_control/unidad_base_id on a droga that
 *     already has a partida.
 *   - m1: `fsj.contar_drogas_por_unidad` did not exist before 0028.
 *
 * M1's LOCK-CONFLICT fix (the trigger re-locking FOR UPDATE so a
 * concurrent partida INSERT serializes against it) is NOT re-proven here
 * with two real connections against fsj.droga/fsj.partida: both tables
 * have `forbid_delete` triggers (migrations 0007/0008), so any row a
 * two-connection test needed to COMMIT (real cross-connection row
 * visibility requires a commit; two separate Client connections can never
 * see each other's uncommitted work) would be permanently stuck in the one
 * shared Supabase database this suite runs against -- the exact same
 * "HONEST SCOPE" limitation tests/db/libro-recetario.test.ts's own
 * two-connection test documents for migration 0018's B1. Until a
 * dedicated, disposable test database exists (that file's own suggested
 * fix), the trigger's SQL-level correctness (this file's "WITH a partida
 * is rejected" test) plus the migration header's lock-conflict reasoning
 * (verified against Postgres's documented row-lock conflict table) are
 * this codebase's evidence for the race being closed -- not an executable
 * two-connection race test.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectDbRejection, expectInvariantViolation } from "./helpers";
import { insertTenant, createSistemaUser, insertUnidad, insertDroga, insertProveedor, crearPartidaConIngreso } from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("migration 0028: B1 (proveedor.cuit normalization)", () => {
  it("rejects a dashed cuit at INSERT (format CHECK now requires exactly 11 digits)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "b1-insert-dash");
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'X', '20-11111111-9')`, [tenantId]),
          "23514",
        );
      }),
    );
  });

  it("rejects a dashed cuit at UPDATE (a bypass of the app-layer transform cannot reintroduce a dashed value)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "b1-update-dash");
        const proveedorId = await insertProveedor(tx, tenantId);
        await expectDbRejection(tx, () => tx.query(`UPDATE fsj.proveedor SET cuit = '20-11111111-9' WHERE id = $1`, [proveedorId]), "23514");
      }),
    );
  });

  it("accepts a plain 11-digit cuit", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "b1-plain-ok");
        const row = await tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'X', '20111111119') RETURNING id`, [
          tenantId,
        ]);
        expect(row.rows[0].id).toBeDefined();
      }),
    );
  });

  it("normalized uniqueness: two proveedores in the same tenant cannot both end up with the same 11-digit cuit", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "b1-dup");
        await tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'X', '20111111119')`, [tenantId]);
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'Y', '20111111119')`, [tenantId]),
          "23505",
        );
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("migration 0028: M1/M2 (INV-DRG-001, DP-12 as a DB trigger)", () => {
  it("rejects changing es_controlada/tipo_control on a droga that already has a partida (INV-DRG-001)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg001-control");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "drg001-control");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        await crearPartidaConIngreso(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema });

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.droga SET es_controlada = true, tipo_control = 'PSICOTROPICO' WHERE id = $1`, [drogaId]),
          "INV-DRG-001",
        );
      }),
    );
  });

  it("rejects changing unidad_base_id on a droga that already has a partida (INV-DRG-001)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg001-unidad");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadOriginal = await insertUnidad(tx, "drg001-unidad-orig");
        const unidadNueva = await insertUnidad(tx, "drg001-unidad-nueva");
        const drogaId = await insertDroga(tx, tenantId, unidadOriginal);
        const proveedorId = await insertProveedor(tx, tenantId);
        await crearPartidaConIngreso(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema });

        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.droga SET unidad_base_id = $1 WHERE id = $2`, [unidadNueva, drogaId]), "INV-DRG-001");
      }),
    );
  });

  it("allows changing es_controlada/tipo_control/unidad_base_id on a droga with NO partidas", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg001-sin-partida");
        const unidadOriginal = await insertUnidad(tx, "drg001-sp-orig");
        const unidadNueva = await insertUnidad(tx, "drg001-sp-nueva");
        const drogaId = await insertDroga(tx, tenantId, unidadOriginal);

        await tx.query(`UPDATE fsj.droga SET es_controlada = true, tipo_control = 'ESTUPEFACIENTE', unidad_base_id = $1 WHERE id = $2`, [
          unidadNueva,
          drogaId,
        ]);

        const after = await tx.query(`SELECT es_controlada, tipo_control, unidad_base_id FROM fsj.droga WHERE id = $1`, [drogaId]);
        expect(after.rows[0].es_controlada).toBe(true);
        expect(after.rows[0].tipo_control).toBe("ESTUPEFACIENTE");
        expect(after.rows[0].unidad_base_id).toBe(unidadNueva);
      }),
    );
  });

  it("allows changing OTHER fields (nombre, stock_minimo) on a droga that already has a partida", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "drg001-otros-campos");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "drg001-otros-campos");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        await crearPartidaConIngreso(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema });

        const nuevoNombre = `Droga-renombrada-${randomUUID()}`;
        await tx.query(`UPDATE fsj.droga SET nombre = $1, stock_minimo = 42 WHERE id = $2`, [nuevoNombre, drogaId]);

        const after = await tx.query(`SELECT nombre, stock_minimo FROM fsj.droga WHERE id = $1`, [drogaId]);
        expect(after.rows[0].nombre).toBe(nuevoNombre);
        expect(Number(after.rows[0].stock_minimo)).toBe(42);
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("migration 0028: m1 (fsj.contar_drogas_por_unidad -- cross-tenant count)", () => {
  it("counts drogas using a unidad ACROSS EVERY TENANT, even when called as fsj_app whose RLS would only show one tenant's own drogas", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "m1-count-a");
        const tenantB = await insertTenant(tx, "m1-count-b");
        const unidadId = await insertUnidad(tx, "m1-count");
        await insertDroga(tx, tenantA, unidadId);
        await insertDroga(tx, tenantB, unidadId);

        // As fsj_app scoped to tenant A: an ordinary RLS-scoped query only
        // sees tenant A's droga (1), but the SECURITY DEFINER function must
        // still report the TRUE cross-tenant total (2).
        await tx.query("SET LOCAL ROLE fsj_app");
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);

        const scoped = await tx.query(`SELECT count(*)::int AS n FROM fsj.droga WHERE unidad_base_id = $1`, [unidadId]);
        expect(scoped.rows[0].n).toBe(1);

        const total = await tx.query(`SELECT fsj.contar_drogas_por_unidad($1) AS n`, [unidadId]);
        expect(total.rows[0].n).toBe(2);
      }),
    );
  });

  it("returns 0 for a unidad no droga references", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const unidadId = await insertUnidad(tx, "m1-count-zero");
        const result = await tx.query(`SELECT fsj.contar_drogas_por_unidad($1) AS n`, [unidadId]);
        expect(result.rows[0].n).toBe(0);
      }),
    );
  });
});
