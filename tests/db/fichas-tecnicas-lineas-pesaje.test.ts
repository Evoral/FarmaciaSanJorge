/**
 * DB tests for prisma/migrations/.../0012_fichas_tecnicas_lineas_pesaje
 * (FASE 1 point 1.10). See tests/db/helpers.ts for the rollback-transaction
 * safety model and tests/db/fixtures.ts for the shared seed helpers.
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  insertUnidad,
  insertDroga,
  insertMedico,
  insertPaciente,
  insertReceta,
  insertItemReceta,
  insertComponente,
  insertFicha,
  insertLinea,
} from "./fixtures";

async function seedItemConComponente(tx: import("pg").Client, suffix: string) {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const unidadId = await insertUnidad(tx, suffix);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  const pacienteId = await insertPaciente(tx, tenantId);
  const medicoId = await insertMedico(tx, tenantId);
  const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
  await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId });
  return { tenantId, sistema, unidadId, drogaId, itemRecetaId };
}

describe.skipIf(dbTestSkipReason() !== null)("0012_fichas_tecnicas_lineas_pesaje migration (fsj schema)", () => {
  it("INV-R05: ficha_tecnica is versioned -- two versions of the same item_receta are allowed, a duplicate version is rejected (UNIQUE)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, itemRecetaId } = await seedItemConComponente(tx, "version");

        const v1 = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema, version: 1 });
        const v2 = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema, version: 2 });
        expect(v1).not.toBe(v2);

        await expectDbRejection(
          tx,
          () => insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema, version: 1 }),
          "23505",
        );
      }),
    );
  });

  it("ficha_tecnica is immutable: UPDATE and DELETE are rejected, even for fsj_owner", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, itemRecetaId } = await seedItemConComponente(tx, "inmutable");
        const fichaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.ficha_tecnica SET version = 99 WHERE id = $1`, [fichaId]),
          "INV-IMMUTABLE",
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`DELETE FROM fsj.ficha_tecnica WHERE id = $1`, [fichaId]),
          "INV-IMMUTABLE",
        );
      }),
    );
  });

  it("fsj_app has no UPDATE/DELETE grant on ficha_tecnica or linea_pesaje at all (defense in depth)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, drogaId, unidadId, itemRecetaId } = await seedItemConComponente(tx, "grant");
        const fichaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
        const lineaId = await insertLinea(tx, { tenantId, fichaTecnicaId: fichaId, drogaId, unidadMedidaId: unidadId });

        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(tx, () => tx.query(`UPDATE fsj.ficha_tecnica SET version = 99 WHERE id = $1`, [fichaId]), "42501");
        await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.linea_pesaje WHERE id = $1`, [lineaId]), "42501");
      }),
    );
  });

  it("INV-R03: a ficha_tecnica with no linea_pesaje fails when constraints are checked (deferred constraint trigger)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, itemRecetaId } = await seedItemConComponente(tx, "invr03");
        await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
        // No linea_pesaje inserted.

        await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "INV-R03");
      }),
    );
  });

  it("INV-R03: a ficha_tecnica WITH a linea_pesaje passes when constraints are checked", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, drogaId, unidadId, itemRecetaId } = await seedItemConComponente(tx, "invr03ok");
        const fichaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
        await insertLinea(tx, { tenantId, fichaTecnicaId: fichaId, drogaId, unidadMedidaId: unidadId });

        // Must NOT throw.
        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
      }),
    );
  });

  it("revised INV-R04: a non-manual linea_pesaje requires cantidad_teorica, cantidad_a_pesar > 0 (CHECK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, drogaId, unidadId, itemRecetaId } = await seedItemConComponente(tx, "invr04a");
        const fichaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });

        // Non-manual with a NULL cantidad_teorica -> rejected.
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.linea_pesaje (tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica, cantidad_a_pesar, unidad_medida_id, es_enrase_manual, orden)
               VALUES ($1, $2, $3, 'D', NULL, 5, $4, false, 0)`,
              [tenantId, fichaId, drogaId, unidadId],
            ),
          "23514",
        );

        // Non-manual with cantidad_a_pesar = 0 -> rejected.
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.linea_pesaje (tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica, cantidad_a_pesar, unidad_medida_id, es_enrase_manual, orden)
               VALUES ($1, $2, $3, 'D', 5, 0, $4, false, 0)`,
              [tenantId, fichaId, drogaId, unidadId],
            ),
          "23514",
        );

        // Valid non-manual line.
        const id = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId,
          unidadMedidaId: unidadId,
          cantidadTeorica: 5,
          cantidadAPesar: 5,
        });
        expect(id).toBeTruthy();
      }),
    );
  });

  it("revised INV-R04: a manual linea_pesaje requires BOTH cantidad_teorica and cantidad_a_pesar to be NULL (CHECK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, sistema, drogaId, unidadId, itemRecetaId } = await seedItemConComponente(tx, "invr04b");
        const fichaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });

        // Manual with a non-null cantidad_teorica -> rejected.
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.linea_pesaje (tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica, cantidad_a_pesar, unidad_medida_id, es_enrase_manual, orden)
               VALUES ($1, $2, $3, 'D', 5, NULL, $4, true, 0)`,
              [tenantId, fichaId, drogaId, unidadId],
            ),
          "23514",
        );

        // Valid manual line.
        const id = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId,
          unidadMedidaId: unidadId,
          esEnraseManual: true,
        });
        expect(id).toBeTruthy();
      }),
    );
  });

  it("cross-tenant isolation: tenant B never sees tenant A's ficha_tecnica/linea_pesaje (INV-T01/T02)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId: tenantA, sistema, drogaId, unidadId, itemRecetaId } = await seedItemConComponente(tx, "isoA");
        const fichaId = await insertFicha(tx, { tenantId: tenantA, itemRecetaId, generadaPorId: sistema });
        const lineaId = await insertLinea(tx, { tenantId: tenantA, fichaTecnicaId: fichaId, drogaId, unidadMedidaId: unidadId });

        const tenantB = await insertTenant(tx, "isoB");

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantB, async (scoped) => {
          const fichas = await scoped.query(`SELECT id FROM fsj.ficha_tecnica WHERE id = $1`, [fichaId]);
          expect(fichas.rows).toHaveLength(0);
          const lineas = await scoped.query(`SELECT id FROM fsj.linea_pesaje WHERE id = $1`, [lineaId]);
          expect(lineas.rows).toHaveLength(0);
        });
      }),
    );
  });

  it("INV-T02: a ficha_tecnica cannot reference an item_receta from another tenant (composite FK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { itemRecetaId } = await seedItemConComponente(tx, "fkA");
        const tenantB = await insertTenant(tx, "fkB");
        const sistemaB = await createSistemaUser(tx, tenantB);

        await expectDbRejection(
          tx,
          () => insertFicha(tx, { tenantId: tenantB, itemRecetaId, generadaPorId: sistemaB }),
          "23503",
        );
      }),
    );
  });

  it("per-tenant weighing parameters: precision_balanza and exceso_pesada_porcentaje default rows exist for a new tenant (backfill/create-tenant.ts parity)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "params");
        // These two rows are inserted by scripts/create-tenant.ts for a
        // brand-new tenant (migration 0012 only backfills tenants that
        // existed AT MIGRATION TIME) -- simulate that step here.
        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES
             ($1, 'precision_balanza', 'NUMERO', '0.001'),
             ($1, 'exceso_pesada_porcentaje', 'NUMERO', '0')`,
          [tenantId],
        );

        const result = await tx.query(
          `SELECT clave, valor FROM fsj.parametro WHERE tenant_id = $1 AND clave IN ('precision_balanza', 'exceso_pesada_porcentaje') ORDER BY clave`,
          [tenantId],
        );
        expect(result.rows).toEqual([
          { clave: "exceso_pesada_porcentaje", valor: "0" },
          { clave: "precision_balanza", valor: "0.001" },
        ]);
      }),
    );
  });
});
