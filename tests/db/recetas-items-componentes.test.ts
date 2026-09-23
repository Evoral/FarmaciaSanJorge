/**
 * DB tests for prisma/migrations/.../0011_recetas_items_componentes
 * (FASE 1 point 1.9). See tests/db/helpers.ts for the rollback-transaction
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
} from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("0011_recetas_items_componentes migration (fsj schema)", () => {
  it("receta.numero_interno is assigned by the DB, increasing per tenant, starting at 1", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "numero");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);

        const r1 = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const r2 = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        const result = await tx.query(`SELECT id, numero_interno FROM fsj.receta WHERE id IN ($1, $2) ORDER BY numero_interno`, [
          r1,
          r2,
        ]);
        expect(Number(result.rows[0].numero_interno)).toBe(1);
        expect(Number(result.rows[1].numero_interno)).toBe(2);
      }),
    );
  });

  it("if the numero_interno trigger were removed, two recetas in the same tenant could collide or start elsewhere -- the app cannot set it: an app-supplied numero_interno is overwritten by the trigger", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "override");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);

        const result = await tx.query(
          `INSERT INTO fsj.receta (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, registrada_por_id, numero_interno)
           VALUES ($1, $2, $3, current_date, 'PRESENCIAL', $4, 999) RETURNING numero_interno`,
          [tenantId, pacienteId, medicoId, sistema],
        );
        expect(Number(result.rows[0].numero_interno)).toBe(1);
      }),
    );
  });

  it("archivo_adjunto_url is required for DIGITAL_PDF / DIGITAL_FOTO origin (CHECK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "adjunto");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);

        await expectDbRejection(
          tx,
          () => insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema, origen: "DIGITAL_PDF" }),
          "23514",
        );

        const id = await insertReceta(tx, {
          tenantId,
          pacienteId,
          medicoId,
          registradaPorId: sistema,
          origen: "DIGITAL_PDF",
          archivoAdjuntoUrl: "https://example.test/x.pdf",
        });
        expect(id).toBeTruthy();
      }),
    );
  });

  it("INV-R08: valid receta state machine chain PENDIENTE_PREPARACION -> EN_PREPARACION -> PREPARADA -> LISTA_PARA_RETIRAR -> ENTREGADA (with receta_fisica_recibida)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "chain");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        for (const estado of ["EN_PREPARACION", "PREPARADA", "LISTA_PARA_RETIRAR"]) {
          await tx.query(`UPDATE fsj.receta SET estado = $1 WHERE id = $2`, [estado, recetaId]);
        }
        await tx.query(`UPDATE fsj.receta SET receta_fisica_recibida = true, receta_fisica_recibida_en = now() WHERE id = $1`, [
          recetaId,
        ]);
        await tx.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE id = $1`, [recetaId]);

        const result = await tx.query(`SELECT estado FROM fsj.receta WHERE id = $1`, [recetaId]);
        expect(result.rows[0].estado).toBe("ENTREGADA");
      }),
    );
  });

  it("INV-R08: PENDIENTE_PREPARACION -> PREPARADA (skipping EN_PREPARACION) is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "skip");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.receta SET estado = 'PREPARADA' WHERE id = $1`, [recetaId]),
          "INV-R08",
        );
      }),
    );
  });

  it("INV-R08: ENTREGADA is terminal (no transition out, even to ANULADA)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "terminal");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        await tx.query(
          `UPDATE fsj.receta SET estado = 'EN_PREPARACION' WHERE id = $1`,
          [recetaId],
        );
        await tx.query(`UPDATE fsj.receta SET estado = 'PREPARADA' WHERE id = $1`, [recetaId]);
        await tx.query(`UPDATE fsj.receta SET estado = 'LISTA_PARA_RETIRAR' WHERE id = $1`, [recetaId]);
        await tx.query(`UPDATE fsj.receta SET receta_fisica_recibida = true, receta_fisica_recibida_en = now() WHERE id = $1`, [
          recetaId,
        ]);
        await tx.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE id = $1`, [recetaId]);

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.receta SET estado = 'ANULADA', motivo_anulacion = 'x' WHERE id = $1`, [recetaId]),
          "INV-R08",
        );
      }),
    );
  });

  it("INV-R08: ANULADA is reachable from a non-terminal state (e.g. PENDIENTE_PREPARACION), with motivo", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "anula");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        await tx.query(`UPDATE fsj.receta SET estado = 'ANULADA', motivo_anulacion = 'paciente no retira' WHERE id = $1`, [
          recetaId,
        ]);

        const result = await tx.query(`SELECT estado FROM fsj.receta WHERE id = $1`, [recetaId]);
        expect(result.rows[0].estado).toBe("ANULADA");
      }),
    );
  });

  it("anulacion requires a motivo (CHECK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "sinmotivo");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.receta SET estado = 'ANULADA' WHERE id = $1`, [recetaId]),
          "23514",
        );
      }),
    );
  });

  it("INV-R07: ENTREGADA requires receta_fisica_recibida (CHECK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "sinfisica");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        await tx.query(`UPDATE fsj.receta SET estado = 'EN_PREPARACION' WHERE id = $1`, [recetaId]);
        await tx.query(`UPDATE fsj.receta SET estado = 'PREPARADA' WHERE id = $1`, [recetaId]);
        await tx.query(`UPDATE fsj.receta SET estado = 'LISTA_PARA_RETIRAR' WHERE id = $1`, [recetaId]);

        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE id = $1`, [recetaId]),
          "23514",
        );
      }),
    );
  });

  it("INV-R01: a receta with no item_receta fails when constraints are checked (deferred constraint trigger)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "sinitem");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        // No item_receta inserted.

        await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "INV-R01");
      }),
    );
  });

  it("INV-R01: a receta WITH an item_receta (that itself has a componente, satisfying V1 too) passes when constraints are checked", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "conitem");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "conitem");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
        await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId });

        // Must NOT throw.
        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
      }),
    );
  });

  it("V1: an item_receta with no componente fails when constraints are checked (deferred constraint trigger)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "v1");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        await insertItemReceta(tx, { tenantId, recetaId });
        // No componente_item_receta inserted for that item.

        await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "V1");
      }),
    );
  });

  it("V2: more than one CSP component per item is rejected (partial unique index)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "v2");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "v2");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });

        await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CSP", orden: 0 });

        await expectDbRejection(
          tx,
          () =>
            insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CSP", orden: 1 }),
          "23505",
        );
      }),
    );
  });

  it("V2: exactly one CSP component per item is accepted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "v2ok");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "v2ok");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });

        const id = await insertComponente(tx, {
          tenantId,
          itemRecetaId,
          drogaId,
          unidadMedidaId: unidadId,
          modoExpresion: "CSP",
          orden: 0,
        });
        expect(id).toBeTruthy();
      }),
    );
  });

  it("V3: a CSP component not occupying the last orden fails when constraints are checked (deferred constraint trigger)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "v3");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "v3");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });

        await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CSP", orden: 0 });
        await insertComponente(tx, {
          tenantId,
          itemRecetaId,
          drogaId,
          unidadMedidaId: unidadId,
          modoExpresion: "TOTAL",
          cantidad: 5,
          orden: 1,
        });

        await expectInvariantViolation(tx, () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"), "V3");
      }),
    );
  });

  it("V3: a CSP component occupying the last orden passes when constraints are checked", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "v3ok");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "v3ok");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });

        await insertComponente(tx, {
          tenantId,
          itemRecetaId,
          drogaId,
          unidadMedidaId: unidadId,
          modoExpresion: "TOTAL",
          cantidad: 5,
          orden: 0,
        });
        await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CSP", orden: 1 });

        // Must NOT throw.
        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
      }),
    );
  });

  it("V6/V7 (DB CHECK): TOTAL/POR_DOSIS require cantidad > 0, CS/CSP require cantidad IS NULL", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "v6v7");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "v6v7");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });

        // V6: TOTAL with cantidad NULL.
        await expectDbRejection(
          tx,
          () =>
            insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "TOTAL", cantidad: null, orden: 0 }),
          "23514",
        );
        // V7: CS with a cantidad.
        await expectDbRejection(
          tx,
          () =>
            insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", cantidad: 5, orden: 0 }),
          "23514",
        );

        // Valid rows of both kinds are accepted.
        const totalId = await insertComponente(tx, {
          tenantId,
          itemRecetaId,
          drogaId,
          unidadMedidaId: unidadId,
          modoExpresion: "TOTAL",
          cantidad: 5,
          orden: 0,
        });
        const csId = await insertComponente(tx, {
          tenantId,
          itemRecetaId,
          drogaId,
          unidadMedidaId: unidadId,
          modoExpresion: "CS",
          cantidad: null,
          orden: 1,
        });
        expect(totalId).toBeTruthy();
        expect(csId).toBeTruthy();
      }),
    );
  });

  it("item_receta: V8 (fraccion_dosis_por_unidad in (0,1]) and V9 (cantidad_unidades > 0) are DB CHECKs", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "v8v9");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        await expectDbRejection(
          tx,
          () => insertItemReceta(tx, { tenantId, recetaId, fraccionDosisPorUnidad: 1.5 }),
          "23514",
        );
        await expectDbRejection(
          tx,
          () => insertItemReceta(tx, { tenantId, recetaId, fraccionDosisPorUnidad: 0 }),
          "23514",
        );
        await expectDbRejection(tx, () => insertItemReceta(tx, { tenantId, recetaId, cantidadUnidades: 0 }), "23514");

        const ok = await insertItemReceta(tx, { tenantId, recetaId, fraccionDosisPorUnidad: 0.5, cantidadUnidades: 30 });
        expect(ok).toBeTruthy();
      }),
    );
  });

  it("cross-tenant isolation: tenant B never sees tenant A's recetas/items/componentes (INV-T01/T02)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "isoA");
        const sistemaA = await createSistemaUser(tx, tenantA);
        const unidadId = await insertUnidad(tx, "iso");
        const drogaA = await insertDroga(tx, tenantA, unidadId);
        const pacienteA = await insertPaciente(tx, tenantA);
        const medicoA = await insertMedico(tx, tenantA);
        const recetaA = await insertReceta(tx, { tenantId: tenantA, pacienteId: pacienteA, medicoId: medicoA, registradaPorId: sistemaA });
        const itemA = await insertItemReceta(tx, { tenantId: tenantA, recetaId: recetaA });
        await insertComponente(tx, { tenantId: tenantA, itemRecetaId: itemA, drogaId: drogaA, unidadMedidaId: unidadId });

        const tenantB = await insertTenant(tx, "isoB");

        // fsj_owner (postgres) has BYPASSRLS -- switch to fsj_app (the
        // runtime role, no BYPASSRLS) so this actually exercises the RLS
        // policy, not just ownership privilege.
        await tx.query("SET LOCAL ROLE fsj_app");

        await withTenant(tx, tenantB, async (scoped) => {
          const recetas = await scoped.query(`SELECT id FROM fsj.receta WHERE id = $1`, [recetaA]);
          expect(recetas.rows).toHaveLength(0);
          const items = await scoped.query(`SELECT id FROM fsj.item_receta WHERE id = $1`, [itemA]);
          expect(items.rows).toHaveLength(0);
        });

        await withTenant(tx, tenantA, async (scoped) => {
          const recetas = await scoped.query(`SELECT id FROM fsj.receta WHERE id = $1`, [recetaA]);
          expect(recetas.rows).toHaveLength(1);
        });
      }),
    );
  });

  it("INV-T02: an item_receta cannot reference a receta from another tenant (composite FK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "fkA");
        const sistemaA = await createSistemaUser(tx, tenantA);
        const pacienteA = await insertPaciente(tx, tenantA);
        const medicoA = await insertMedico(tx, tenantA);
        const recetaA = await insertReceta(tx, { tenantId: tenantA, pacienteId: pacienteA, medicoId: medicoA, registradaPorId: sistemaA });

        const tenantB = await insertTenant(tx, "fkB");

        await expectDbRejection(
          tx,
          () => insertItemReceta(tx, { tenantId: tenantB, recetaId: recetaA }),
          "23503",
        );
      }),
    );
  });

  it("no DELETE grant on receta for fsj_app (item_receta/componente_item_receta gained a CONDITIONAL grant in migration 0030 -- see tests/db/recetas-edicion-delete-guard.test.ts)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "nodelete");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.receta WHERE id = $1`, [recetaId]), "42501");
      }),
    );
  });
});
