/**
 * DB tests for migrations 0132 & 0133 (openspec/changes/unidad-internacional):
 *   - UNIDAD_INTERNACIONAL seed & ACTIVIDAD magnitude
 *   - droga.se_dosifica_en_ui CHECKs and trigger
 *   - partida.actividad_declarada CHECKs and trigger
 *   - INV-S12 (fsj.linea_pesaje_validar_consumo) for %, U.I., enrase manual,
 *     equivalencia manual, and mixed manual+computed (refused).
 *
 * Requires migrations 0132 and 0133 applied in the target DB (opt-in: `npm run test:db`).
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, expectInvariantViolation, inRollbackTx } from "./helpers";
import {
  createSistemaUser,
  insertDroga,
  insertFicha,
  insertItemReceta,
  insertLinea,
  insertMedico,
  insertPaciente,
  insertProveedor,
  insertReceta,
  insertTenant,
  insertUnidad,
} from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("Unidad Internacional (0132/0133): CHECKs, triggers & INV-S12", () => {
  it("seeds UNIDAD_INTERNACIONAL (U.I.) as base unit of ACTIVIDAD", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const res = await tx.query<{
          codigo: string;
          simbolo: string;
          tipo_magnitud: string;
          factor_a_base: string;
          es_base: boolean;
        }>(
          `SELECT codigo, simbolo, tipo_magnitud::text, factor_a_base::text, es_base
           FROM fsj.unidad_medida
           WHERE codigo = 'UNIDAD_INTERNACIONAL'`,
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0]).toEqual({
          codigo: "UNIDAD_INTERNACIONAL",
          simbolo: "U.I.",
          tipo_magnitud: "ACTIVIDAD",
          factor_a_base: "1.0000000000",
          es_base: true,
        });
      }),
    );
  });

  it("enforces droga.se_dosifica_en_ui CHECK (clase=DROGA) and trigger (MASA, no active UI stock on unset)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "UI Droga");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadGramo = await insertUnidad(tx, "g", "MASA", 1);
        const unidadMl = await insertUnidad(tx, "mL", "VOLUMEN", 1);
        const proveedorId = await insertProveedor(tx, tenantId);

        // EXCIPIENTE cannot be marked se_dosifica_en_ui
        await expect(
          tx.query(
            `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase, se_dosifica_en_ui)
             VALUES ($1, 'Excipiente UI', $2, 'EXCIPIENTE', true)`,
            [tenantId, unidadGramo],
          ),
        ).rejects.toThrow(/droga_se_dosifica_en_ui_clase_check/);

        // VOLUMEN unidad_base cannot be marked se_dosifica_en_ui
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase, se_dosifica_en_ui)
               VALUES ($1, 'Droga Liquida UI', $2, 'DROGA', true)`,
              [tenantId, unidadMl],
            ),
          "MASA required",
        );

        // Valid MASA DROGA with se_dosifica_en_ui = true + U.I. partida with stock > 0
        const drogaRes = await tx.query<{ id: string }>(
          `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase, se_dosifica_en_ui)
           VALUES ($1, 'Vitamina D3', $2, 'DROGA', true)
           RETURNING id`,
          [tenantId, unidadGramo],
        );
        const drogaId = drogaRes.rows[0]!.id;

        const partidaRes = await tx.query<{ id: string }>(
          `INSERT INTO fsj.partida
             (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, actividad_declarada)
           VALUES ($1, $2, $3, 'L-D3-1', 100, 10, '2099-12-31', 100000)
           RETURNING id`,
          [tenantId, drogaId, proveedorId],
        );
        await tx.query(
          `INSERT INTO fsj.movimiento_stock
             (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_COMPRA', 10, $3)`,
          [tenantId, partidaRes.rows[0]!.id, sistema],
        );

        // Cannot unset se_dosifica_en_ui while UI partida has cantidad_disponible > 0
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `UPDATE fsj.droga SET se_dosifica_en_ui = false WHERE tenant_id = $1 AND id = $2`,
              [tenantId, drogaId],
            ),
          "cantidad_disponible > 0",
        );
      }),
    );
  });

  it("enforces partida.actividad_declarada CHECKs and immutable kind trigger", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "UI Partida");
        const unidadGramo = await insertUnidad(tx, "g", "MASA", 1);
        const proveedorId = await insertProveedor(tx, tenantId);
        const drogaSinUi = await insertDroga(tx, tenantId, unidadGramo);
        const drogaConUiRes = await tx.query<{ id: string }>(
          `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase, se_dosifica_en_ui)
           VALUES ($1, 'Vitamina A', $2, 'DROGA', true)
           RETURNING id`,
          [tenantId, unidadGramo],
        );
        const drogaConUi = drogaConUiRes.rows[0]!.id;

        // Unmarked droga rejects actividad_declarada
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.partida
                 (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, actividad_declarada)
               VALUES ($1, $2, $3, 'L-ERR-1', 100, 10, '2099-12-31', 1000)`,
              [tenantId, drogaSinUi, proveedorId],
            ),
          "se_dosifica_en_ui",
        );

        // actividad_declarada <= 0 rejected
        await expect(
          tx.query(
            `INSERT INTO fsj.partida
               (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, actividad_declarada)
             VALUES ($1, $2, $3, 'L-ERR-2', 100, 10, '2099-12-31', 0)`,
            [tenantId, drogaConUi, proveedorId],
          ),
        ).rejects.toThrow(/partida_actividad_declarada_check/);

        // Both potencia_declarada and actividad_declarada rejected
        await expect(
          tx.query(
            `INSERT INTO fsj.partida
               (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada, actividad_declarada)
             VALUES ($1, $2, $3, 'L-ERR-3', 100, 10, '2099-12-31', 95, 1000)`,
            [tenantId, drogaConUi, proveedorId],
          ),
        ).rejects.toThrow(/partida_potencia_o_actividad_check/);

        // Kind (NULL vs NOT NULL) is immutable after insert
        const pUi = await tx.query<{ id: string }>(
          `INSERT INTO fsj.partida
             (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, actividad_declarada)
           VALUES ($1, $2, $3, 'L-OK-UI', 100, 10, '2099-12-31', 1000)
           RETURNING id`,
          [tenantId, drogaConUi, proveedorId],
        );
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `UPDATE fsj.partida SET actividad_declarada = NULL WHERE tenant_id = $1 AND id = $2`,
              [tenantId, pUi.rows[0]!.id],
            ),
          "switch between gram lot and U.I. lot",
        );

        // Updating actividad_declarada (NOT NULL -> NOT NULL) is allowed
        await tx.query(
          `UPDATE fsj.partida SET actividad_declarada = 2000 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, pUi.rows[0]!.id],
        );

        // Item 1: after unmarking droga (at balance 0), a stock movement updating cantidad_disponible still succeeds
        await tx.query(
          `UPDATE fsj.droga SET se_dosifica_en_ui = false WHERE tenant_id = $1 AND id = $2`,
          [tenantId, drogaConUi],
        );
        const sistema = await createSistemaUser(tx, tenantId);
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_COMPRA', 5, $3)`,
          [tenantId, pUi.rows[0]!.id, sistema],
        );
      }),
    );
  });

  it("validates INV-S12 for %, U.I., enrase manual, equivalencia manual, and rejects mixed manual+computed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "UI INV-S12");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadGramoRes = await tx.query<{ id: string }>(
          `SELECT id FROM fsj.unidad_medida WHERE codigo = 'GRAMO'`,
        );
        const unidadUiRes = await tx.query<{ id: string }>(
          `SELECT id FROM fsj.unidad_medida WHERE codigo = 'UNIDAD_INTERNACIONAL'`,
        );
        const unidadGramo = unidadGramoRes.rows[0]!.id;
        const unidadUi = unidadUiRes.rows[0]!.id;
        const proveedorId = await insertProveedor(tx, tenantId);

        const drogaPctId = await insertDroga(tx, tenantId, unidadGramo);
        const drogaUiRes = await tx.query<{ id: string }>(
          `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase, se_dosifica_en_ui)
           VALUES ($1, 'Vitamina E', $2, 'DROGA', true)
           RETURNING id`,
          [tenantId, unidadGramo],
        );
        const drogaUiId = drogaUiRes.rows[0]!.id;

        // Seed partidas (with INGRESO_COMPRA so cantidad_disponible > 0)
        const pPct = (
          await tx.query<{ id: string }>(
            `INSERT INTO fsj.partida
               (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
             VALUES ($1, $2, $3, 'L-PCT', 10, 100, '2099-12-31', 50)
             RETURNING id`,
            [tenantId, drogaPctId, proveedorId],
          )
        ).rows[0]!.id;
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_COMPRA', 100, $3)`,
          [tenantId, pPct, sistema],
        );

        const pUiA = (
          await tx.query<{ id: string }>(
            `INSERT INTO fsj.partida
               (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, actividad_declarada)
             VALUES ($1, $2, $3, 'L-UI-A', 10, 50, '2099-12-31', 100000)
             RETURNING id`,
            [tenantId, drogaUiId, proveedorId],
          )
        ).rows[0]!.id;
        const pUiB = (
          await tx.query<{ id: string }>(
            `INSERT INTO fsj.partida
               (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, actividad_declarada)
             VALUES ($1, $2, $3, 'L-UI-B', 10, 50, '2099-12-31', 40000)
             RETURNING id`,
            [tenantId, drogaUiId, proveedorId],
          )
        ).rows[0]!.id;
        for (const pid of [pUiA, pUiB]) {
          await tx.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
             VALUES ($1, $2, 'INGRESO_COMPRA', 50, $3)`,
            [tenantId, pid, sistema],
          );
        }

        // Build receta -> item -> ficha -> 5 lineas -> preparacion
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
        await tx.query(
          `INSERT INTO fsj.componente_item_receta (tenant_id, item_receta_id, droga_id, modo_expresion, cantidad, unidad_medida_id)
           VALUES ($1, $2, $3, 'CS', NULL, $4)`,
          [tenantId, itemRecetaId, drogaPctId, unidadGramo],
        );
        const fichaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });

        const lineaPct = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaPctId,
          unidadMedidaId: unidadGramo,
          cantidadAPesar: 5,
          orden: 0,
        });
        const lineaUi = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaUiId,
          unidadMedidaId: unidadUi,
          cantidadAPesar: 500000,
          orden: 1,
        });
        const lineaManual = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaPctId,
          unidadMedidaId: unidadGramo,
          esEnraseManual: true,
          cantidadAPesar: null,
          orden: 2,
        });
        const lineaEqManual = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaUiId,
          unidadMedidaId: unidadUi,
          cantidadAPesar: 1000,
          orden: 3,
        });
        const lineaMixed = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaUiId,
          unidadMedidaId: unidadUi,
          cantidadAPesar: 1000,
          orden: 4,
        });

        const prepId = (
          await tx.query<{ id: string }>(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
            [tenantId, fichaId, sistema],
          )
        ).rows[0]!.id;

        // 1. % line: 10 g @ 50% = 5 g active
        await tx.query(
          `INSERT INTO fsj.movimiento_stock
             (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, potencia_aplicada, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 10, $3, $4, 50, $5)`,
          [tenantId, pPct, prepId, lineaPct, sistema],
        );
        await tx.query(`SELECT fsj.linea_pesaje_validar_consumo($1, $2)`, [tenantId, lineaPct]);

        // 2. U.I. line: 3 g @ 100.000 UI/g + 5 g @ 40.000 UI/g = 500.000 UI
        await tx.query(
          `INSERT INTO fsj.movimiento_stock
             (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, actividad_aplicada, registrado_por_id)
           VALUES
             ($1, $2, 'EGRESO_PREPARACION', 3, $4, $5, 100000, $6),
             ($1, $3, 'EGRESO_PREPARACION', 5, $4, $5, 40000,  $6)`,
          [tenantId, pUiA, pUiB, prepId, lineaUi, sistema],
        );
        await tx.query(`SELECT fsj.linea_pesaje_validar_consumo($1, $2)`, [tenantId, lineaUi]);

        // 3. Enrase manual: positive physical sum passes
        await tx.query(
          `INSERT INTO fsj.movimiento_stock
             (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 2, $3, $4, $5)`,
          [tenantId, pPct, prepId, lineaManual, sistema],
        );
        await tx.query(`SELECT fsj.linea_pesaje_validar_consumo($1, $2)`, [tenantId, lineaManual]);

        // 4. Equivalencia manual: positive physical sum passes without actividad_aplicada
        await tx.query(
          `INSERT INTO fsj.movimiento_stock
             (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, equivalencia_manual, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 1.5, $3, $4, true, $5)`,
          [tenantId, pUiA, prepId, lineaEqManual, sistema],
        );
        await tx.query(`SELECT fsj.linea_pesaje_validar_consumo($1, $2)`, [tenantId, lineaEqManual]);

        // 5. Mixed equivalencia_manual = true and false on same line -> refused
        await tx.query(
          `INSERT INTO fsj.movimiento_stock
             (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, equivalencia_manual, actividad_aplicada, registrado_por_id)
           VALUES
             ($1, $2, 'EGRESO_PREPARACION', 1, $3, $4, true,  NULL,   $5),
             ($1, $2, 'EGRESO_PREPARACION', 1, $3, $4, false, 100000, $5)`,
          [tenantId, pUiA, prepId, lineaMixed, sistema],
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.linea_pesaje_validar_consumo($1, $2)`, [tenantId, lineaMixed]),
          "cannot mix equivalencia_manual and computed movements",
        );

        // 6. Item 2: non-ACTIVIDAD linea consuming a U.I. movement (actividad_aplicada NOT NULL) -> refused
        const lineaMassWithUi = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaPctId,
          unidadMedidaId: unidadGramo,
          cantidadAPesar: 5,
          orden: 5,
        });
        await tx.query(
          `INSERT INTO fsj.movimiento_stock
             (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, actividad_aplicada, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 5, $3, $4, 100000, $5)`,
          [tenantId, pUiA, prepId, lineaMassWithUi, sistema],
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.linea_pesaje_validar_consumo($1, $2)`, [tenantId, lineaMassWithUi]),
          "cannot consume a movement with actividad_aplicada",
        );

        // 7. Item 2: equivalencia_manual = true with potencia_aplicada or actividad_aplicada NOT NULL -> refused
        const lineaEqWithFactor = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaUiId,
          unidadMedidaId: unidadUi,
          cantidadAPesar: 1000,
          orden: 6,
        });
        await tx.query(
          `INSERT INTO fsj.movimiento_stock
             (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, equivalencia_manual, actividad_aplicada, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 1, $3, $4, true, 100000, $5)`,
          [tenantId, pUiA, prepId, lineaEqWithFactor, sistema],
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.linea_pesaje_validar_consumo($1, $2)`, [tenantId, lineaEqWithFactor]),
          "equivalencia_manual movements cannot carry",
        );

        // 8. Item 4: droga in KILOGRAMO scales U.I. tolerance by factor_a_base (1000)
        // Required: 150 UI; lot at 1000 UI/g -> 0.00015 kg, rounded UP to 4 decimals = 0.0002 kg = 200 UI (overshoot = 50 UI < 0.0001 * 1000 * 1000 = 100 UI).
        const unidadKg = (await tx.query<{ id: string }>(`SELECT id FROM fsj.unidad_medida WHERE codigo = 'KILOGRAMO'`)).rows[0]!.id;
        const drogaKgId = (
          await tx.query<{ id: string }>(
            `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase, se_dosifica_en_ui)
             VALUES ($1, 'Vitamina Kg', $2, 'DROGA', true)
             RETURNING id`,
            [tenantId, unidadKg],
          )
        ).rows[0]!.id;
        const pKg = (
          await tx.query<{ id: string }>(
            `INSERT INTO fsj.partida
               (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, actividad_declarada)
             VALUES ($1, $2, $3, 'L-KG', 10, 1, '2099-12-31', 1000)
             RETURNING id`,
            [tenantId, drogaKgId, proveedorId],
          )
        ).rows[0]!.id;
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_COMPRA', 1, $3)`,
          [tenantId, pKg, sistema],
        );
        const lineaKg = await insertLinea(tx, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaKgId,
          unidadMedidaId: unidadUi,
          cantidadAPesar: 150,
          orden: 7,
        });
        await tx.query(
          `INSERT INTO fsj.movimiento_stock
             (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, actividad_aplicada, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 0.0002, $3, $4, 1000, $5)`,
          [tenantId, pKg, prepId, lineaKg, sistema],
        );
        await tx.query(`SELECT fsj.linea_pesaje_validar_consumo($1, $2)`, [tenantId, lineaKg]);
      }),
    );
  });
});
