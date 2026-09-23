/**
 * DB tests for prisma/migrations/.../0023_inv_u07_actor_activo.
 *
 * INV-U07 (plan M02): "Mientras la cuenta permanezca en
 * PENDIENTE_ACTIVACION no puede operar sobre ningun modulo ni figurar como
 * responsable de ninguna accion registrada." Migration 0023 attaches a
 * generic trigger (fsj.assert_actor_activo) to every table/column listed
 * in that migration's header, checking that the referenced usuario is
 * ACTIVO -- see that header for the full coverage list and the reasoning
 * behind every "careful case" decision (self-reference bootstrap,
 * registro_auditoria exclusion, trigger firing order against INV-U05/
 * INV-U04, etc.). This file exercises a representative subset, exactly
 * like every other tests/db/*.test.ts (raw `pg` + `asOwner`/`inRollbackTx`
 * -- see tests/db/helpers.ts's module doc comment for why).
 *
 * CATALOG TABLE FINDING (read before looking for a "droga is rejected"
 * test -- there isn't one): the task asked for a representative rejection
 * test on "a catalog table such as droga". Checked directly against the
 * schema (see the "catalog tables have no actor column at all" test
 * below, and migration 0023's header): fsj.droga, fsj.proveedor,
 * fsj.medico, fsj.paciente and fsj.unidad_medida have NO creado_por_id (or
 * any other actor) column whatsoever -- nobody is ever recorded as having
 * created or edited a catalog row, regardless of estado. There is
 * therefore nothing for INV-U07 to attach to on droga specifically. This
 * is a PRE-EXISTING, separate gap (catalog rows have no author at all),
 * out of INV-U07's scope (adding a new column is a schema change, not
 * wiring an invariant onto an existing one) -- flagged, not silently
 * worked around. fsj.ficha_tecnica (generada_por_id) is used below as the
 * closest catalog-ADJACENT table that actually has an actor column (it is
 * a versioned template/formula row, the nearest thing to a "catalog entry
 * with an author" this schema has).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  createUserWithRole,
  crearLibrosRubricados,
  designarDt,
  seedAsientoSistema,
  seedFichaCompleta,
  insertUnidad,
  insertDroga,
  insertProveedor,
  crearPartidaConIngreso,
} from "./fixtures";

type EstadoNoActivo = "PENDIENTE_ACTIVACION" | "SUSPENDIDO" | "BAJA";
const ESTADOS_RECHAZADOS: EstadoNoActivo[] = ["PENDIENTE_ACTIVACION", "SUSPENDIDO", "BAJA"];

describe.skipIf(dbTestSkipReason() !== null)("INV-U07 (migration 0023): actor columns require usuario.estado = ACTIVO", () => {
  describe("fsj.movimiento_stock.registrado_por_id (INSERT)", () => {
    it("PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA are rejected, ACTIVO succeeds -- uses tipo AJUSTE (not a second INGRESO_COMPRA, which INV-S03 structurally rejects regardless of amount -- cantidad_disponible can never exceed the partida's fixed cantidad_inicial) with autorizado_por_id held fixed as a vigente ACTIVO DT, so INV-U05 never fires first", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const tenantId = await insertTenant(tx, "u07mov");
          const sistema = await createSistemaUser(tx, tenantId);
          const unidadId = await insertUnidad(tx, "u07mov");
          const drogaId = await insertDroga(tx, tenantId, unidadId);
          const proveedorId = await insertProveedor(tx, tenantId);
          const partidaId = await crearPartidaConIngreso(tx, {
            tenantId,
            drogaId,
            proveedorId,
            registradoPorId: sistema,
            cantidadInicial: 1000,
          });
          const dtId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "movdt", "ACTIVO");
          await designarDt(tx, tenantId, dtId, sistema);

          for (const estado of ESTADOS_RECHAZADOS) {
            const actor = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, `mov-${estado}`, estado);
            await expectInvariantViolation(
              tx,
              () =>
                tx.query(
                  `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, motivo_ajuste, autorizado_por_id, registrado_por_id)
                   VALUES ($1, $2, 'AJUSTE', 1, 'DIFERENCIA_ARQUEO', $3, $4)`,
                  [tenantId, partidaId, dtId, actor],
                ),
              "INV-U07",
            );
          }

          const activo = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "mov-activo", "ACTIVO");
          const result = await tx.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, motivo_ajuste, autorizado_por_id, registrado_por_id)
             VALUES ($1, $2, 'AJUSTE', 1, 'DIFERENCIA_ARQUEO', $3, $4) RETURNING id`,
            [tenantId, partidaId, dtId, activo],
          );
          expect(result.rows).toHaveLength(1);
        }),
      );
    });
  });

  describe("fsj.asiento_recetario.registrado_por_id (INSERT)", () => {
    it("PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA are rejected, ACTIVO succeeds", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema, fichaTecnicaId } = await seedFichaCompleta(tx, "u07ase");
          await crearLibrosRubricados(tx, tenantId, sistema);
          const preparacion = await tx.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
            [tenantId, fichaTecnicaId, sistema],
          );
          const preparacionId = preparacion.rows[0].id as string;

          for (const estado of ESTADOS_RECHAZADOS) {
            const actor = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, `ase-${estado}`, estado);
            await expectInvariantViolation(
              tx,
              async () => {
                // D4 (migration 0034): a detalle_asiento row must already
                // exist under the asiento's (app-generated) id, or the
                // "preparar" trigger raises INV-L22 BEFORE this test's own
                // trg_asiento_recetario_zz_inv_u07_insert ever runs
                // ("preparar" < "zz_inv_u07_insert" alphabetically) --
                // masking the INV-U07 rejection this test targets.
                const asientoId = randomUUID();
                await tx.query(
                  `INSERT INTO fsj.detalle_asiento (tenant_id, asiento_recetario_id, descripcion, cantidad, unidad_texto, orden)
                   VALUES ($1, $2, 'Droga', 5, 'g', 0)`,
                  [tenantId, asientoId],
                );
                return tx.query(
                  `INSERT INTO fsj.asiento_recetario (id, tenant_id, origen, preparacion_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
                   VALUES ($1, $2, 'SISTEMA', $3, 'Paciente', 'Medico - MAT-1', 'Formula', $4)`,
                  [asientoId, tenantId, preparacionId, actor],
                );
              },
              "INV-U07",
            );
          }

          const activo = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "ase-activo", "ACTIVO");
          const asientoIdOk = randomUUID();
          await tx.query(
            `INSERT INTO fsj.detalle_asiento (tenant_id, asiento_recetario_id, descripcion, cantidad, unidad_texto, orden)
             VALUES ($1, $2, 'Droga', 5, 'g', 0)`,
            [tenantId, asientoIdOk],
          );
          const result = await tx.query(
            `INSERT INTO fsj.asiento_recetario (id, tenant_id, origen, preparacion_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
             VALUES ($1, $2, 'SISTEMA', $3, 'Paciente', 'Medico - MAT-1', 'Formula', $4) RETURNING id`,
            [asientoIdOk, tenantId, preparacionId, activo],
          );
          expect(result.rows).toHaveLength(1);
        }),
      );
    });
  });

  describe("fsj.anulacion_asiento.anulado_por_id (INSERT)", () => {
    it("PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA are rejected, ACTIVO succeeds -- autorizado_por_id is held fixed as a vigente ACTIVO DT so INV-U05 never fires first (it is not what this test targets)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const seed = await seedAsientoSistema(tx, "u07anu");
          const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "u07anudt", "ACTIVO");
          await designarDt(tx, seed.tenantId, dtId, seed.sistema);

          for (const estado of ESTADOS_RECHAZADOS) {
            const actor = await createUserWithRole(tx, seed.tenantId, "FARMACEUTICO", seed.sistema, `anu-${estado}`, estado);
            await expectInvariantViolation(
              tx,
              () =>
                tx.query(
                  `INSERT INTO fsj.anulacion_asiento (tenant_id, asiento_id, motivo, autorizado_por_id, anulado_por_id)
                   VALUES ($1, $2, 'motivo de prueba', $3, $4)`,
                  [seed.tenantId, seed.asientoId, dtId, actor],
                ),
              "INV-U07",
            );
          }

          const activo = await createUserWithRole(tx, seed.tenantId, "FARMACEUTICO", seed.sistema, "anu-activo", "ACTIVO");
          const result = await tx.query(
            `INSERT INTO fsj.anulacion_asiento (tenant_id, asiento_id, motivo, autorizado_por_id, anulado_por_id)
             VALUES ($1, $2, 'motivo de prueba', $3, $4) RETURNING id`,
            [seed.tenantId, seed.asientoId, dtId, activo],
          );
          expect(result.rows).toHaveLength(1);
        }),
      );
    });
  });

  describe("fsj.preparacion (INSERT: iniciada_por_id / UPDATE: preparada_por_id, descartada_por_id)", () => {
    it("iniciada_por_id: PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA are rejected, ACTIVO succeeds", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema, fichaTecnicaId } = await seedFichaCompleta(tx, "u07prep");

          for (const estado of ESTADOS_RECHAZADOS) {
            const actor = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, `prep-${estado}`, estado);
            await expectInvariantViolation(
              tx,
              () => tx.query(`INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3)`, [
                tenantId,
                fichaTecnicaId,
                actor,
              ]),
              "INV-U07",
            );
          }

          const activo = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "prep-activo", "ACTIVO");
          const result = await tx.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
            [tenantId, fichaTecnicaId, activo],
          );
          expect(result.rows).toHaveLength(1);
        }),
      );
    });

    it("preparada_por_id (CONFIRMADA transition, NULL -> value): PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA are rejected, ACTIVO succeeds -- and the row's OWN iniciada_por_id author (now SUSPENDIDO) is never re-validated by the UPDATE", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema, fichaTecnicaId } = await seedFichaCompleta(tx, "u07confirma");
          const iniciador = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "confirma-iniciador", "ACTIVO");
          const preparacion = await tx.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
            [tenantId, fichaTecnicaId, iniciador],
          );
          const preparacionId = preparacion.rows[0].id as string;

          // The row's author is suspended AFTER starting it -- INV-U07's
          // UPDATE mode only checks the preparada_por_id NULL -> value
          // transition, never re-validates iniciada_por_id (INV-U03: the
          // historical fact of who started it must survive unchanged).
          await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [iniciador]);

          for (const estado of ESTADOS_RECHAZADOS) {
            const actor = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, `confirma-${estado}`, estado);
            await expectInvariantViolation(
              tx,
              () =>
                tx.query(
                  `UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`,
                  [actor, preparacionId],
                ),
              "INV-U07",
            );
          }

          const activo = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "confirma-activo", "ACTIVO");
          const result = await tx.query(
            `UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2 RETURNING preparada_por_id, iniciada_por_id`,
            [activo, preparacionId],
          );
          expect(result.rows[0].preparada_por_id).toBe(activo);
          // The historical row still points at the now-SUSPENDIDO iniciador --
          // untouched, still readable, never re-validated.
          expect(result.rows[0].iniciada_por_id).toBe(iniciador);
          const iniciadorRow = await tx.query(`SELECT estado FROM fsj.usuario WHERE id = $1`, [iniciador]);
          expect(iniciadorRow.rows[0].estado).toBe("SUSPENDIDO");
        }),
      );
    });
  });

  describe("fsj.cierre_diario.director_tecnico_id (INSERT -- raw, bypassing fsj.cierre_diario_firmar())", () => {
    it("PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA are rejected, ACTIVO succeeds -- exercised as a raw INSERT since fsj.cierre_diario_firmar() already enforces INV-U04 (ACTIVO) before ever reaching this INSERT, so INV-U07 can only be observed here directly (see migration 0023 header, 'Ordering')", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const seed = await seedAsientoSistema(tx, "u07cierre");
          const fecha = await tx.query(`SELECT fecha_asiento::text AS f FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
          const fechaAsiento = fecha.rows[0].f as string;

          const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "u07cierredt", "ACTIVO");
          const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema);

          for (const estado of ESTADOS_RECHAZADOS) {
            const actor = await createUserWithRole(tx, seed.tenantId, "FARMACEUTICO", seed.sistema, `cierre-${estado}`, estado);
            await expectInvariantViolation(
              tx,
              () =>
                tx.query(
                  `INSERT INTO fsj.cierre_diario (tenant_id, fecha, director_tecnico_id, designacion_id, matricula_dt, cantidad_asientos, hash_lote, fuera_de_termino)
                   VALUES ($1, $2, $3, $4, 'MAT-U07', 0, 'hash-u07', false)`,
                  [seed.tenantId, fechaAsiento, actor, designacionId],
                ),
              "INV-U07",
            );
          }

          const result = await tx.query(
            `INSERT INTO fsj.cierre_diario (tenant_id, fecha, director_tecnico_id, designacion_id, matricula_dt, cantidad_asientos, hash_lote, fuera_de_termino)
             VALUES ($1, $2, $3, $4, 'MAT-U07', 0, 'hash-u07', false) RETURNING id`,
            [seed.tenantId, fechaAsiento, dtId, designacionId],
          );
          expect(result.rows).toHaveLength(1);
        }),
      );
    });
  });

  describe("fsj.ficha_tecnica.generada_por_id (INSERT) -- closest catalog-adjacent table with an actor column, see file header", () => {
    it("PENDIENTE_ACTIVACION / SUSPENDIDO / BAJA are rejected, ACTIVO succeeds", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema, itemRecetaId } = await seedFichaCompleta(tx, "u07ficha");

          for (const estado of ESTADOS_RECHAZADOS) {
            const actor = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, `ficha-${estado}`, estado);
            await expectInvariantViolation(
              tx,
              () =>
                tx.query(`INSERT INTO fsj.ficha_tecnica (tenant_id, item_receta_id, version, generada_por_id) VALUES ($1, $2, 2, $3)`, [
                  tenantId,
                  itemRecetaId,
                  actor,
                ]),
              "INV-U07",
            );
          }

          const activo = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "ficha-activo", "ACTIVO");
          const result = await tx.query(
            `INSERT INTO fsj.ficha_tecnica (tenant_id, item_receta_id, version, generada_por_id) VALUES ($1, $2, 2, $3) RETURNING id`,
            [tenantId, itemRecetaId, activo],
          );
          expect(result.rows).toHaveLength(1);
        }),
      );
    });
  });

  describe("catalog tables (fsj.droga, fsj.proveedor, fsj.medico, fsj.paciente, fsj.unidad_medida) have NO actor column at all", () => {
    it("confirms the finding documented in this file's header and in migration 0023's header -- nothing for INV-U07 to attach to", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const result = await tx.query(
            `SELECT c.relname AS table_name, a.attname AS column_name
             FROM pg_attribute a
             JOIN pg_class c ON c.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'fsj'
               AND c.relname IN ('droga', 'proveedor', 'medico', 'paciente', 'unidad_medida')
               AND a.attnum > 0 AND NOT a.attisdropped
               AND (a.attname LIKE '%\\_por\\_id' ESCAPE '\\' OR a.attname LIKE 'creado%' OR a.attname LIKE 'registrado%')`,
          );
          expect(result.rows).toEqual([]);
        }),
      );
    });
  });

  describe("scripts/create-tenant.ts bootstrap sequence still works under INV-U07", () => {
    it("SISTEMA self-references creado_por_id while declaring itself ACTIVO in the same INSERT, then creates the first ADM (PENDIENTE_ACTIVACION, creado_por_id = SISTEMA)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const tenantId = await insertTenant(tx, "u07bootstrap");

          // Mirrors scripts/create-tenant.ts exactly.
          const sistemaId = randomUUID();
          await tx.query(
            `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
             VALUES ($1, $2, $3, 'Sistema', 'Tecnico', $4, 'ACTIVO', true, $1)`,
            [sistemaId, tenantId, `sistema+${sistemaId}@internal.local`, `SISTEMA-${sistemaId}`],
          );
          const sistemaRol = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'SISTEMA'`);
          await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $2)`, [
            tenantId,
            sistemaId,
            sistemaRol.rows[0].id,
          ]);

          const adminId = randomUUID();
          await tx.query(
            `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
             VALUES ($1, $2, $3, 'Admin', 'Uno', $4, 'PENDIENTE_ACTIVACION', false, $5)`,
            [adminId, tenantId, `admin+${adminId}@example.com`, `DNI-${adminId}`, sistemaId],
          );
          const adminRol = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'ADMINISTRADOR'`);
          await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $4)`, [
            tenantId,
            adminId,
            adminRol.rows[0].id,
            sistemaId,
          ]);

          const credencial = await tx.query(
            `INSERT INTO fsj.credencial_activacion (tenant_id, usuario_id, token_hash, emitida_por_id, vence_en, motivo_emision)
             VALUES ($1, $2, $3, $4, now() + interval '72 hours', 'ALTA') RETURNING id`,
            [tenantId, adminId, `hash-${randomUUID()}`, sistemaId],
          );

          await crearLibrosRubricados(tx, tenantId, sistemaId);

          expect(credencial.rows).toHaveLength(1);
          const sistemaRow = await tx.query(`SELECT estado, creado_por_id FROM fsj.usuario WHERE id = $1`, [sistemaId]);
          expect(sistemaRow.rows[0]).toMatchObject({ estado: "ACTIVO", creado_por_id: sistemaId });
          const adminRow = await tx.query(`SELECT estado, creado_por_id FROM fsj.usuario WHERE id = $1`, [adminId]);
          expect(adminRow.rows[0]).toMatchObject({ estado: "PENDIENTE_ACTIVACION", creado_por_id: sistemaId });
        }),
      );
    });
  });

  describe("catalog-level regression guard: every *_por_id column (plus the explicit extras) has the INV-U07 trigger configured for it", () => {
    it("fails CI if a future table/column with a *_por_id-shaped actor column forgets to wire the trigger", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const result = await tx.query(`
            WITH por_id_columns AS (
              SELECT c.relname AS table_name, a.attname AS column_name
              FROM pg_attribute a
              JOIN pg_class c ON c.oid = a.attrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'fsj' AND c.relkind = 'r'
                AND a.attnum > 0 AND NOT a.attisdropped
                AND a.attname LIKE '%\\_por\\_id' ESCAPE '\\'
            ),
            -- Deliberately excluded -- see migration 0023 header.
            excluded AS (
              SELECT 'registro_auditoria' AS table_name, 'autorizado_por_id' AS column_name
            ),
            extras AS (
              -- Explicit non-"*_por_id"-named actor columns this migration also covers.
              SELECT 'cierre_diario' AS table_name, 'director_tecnico_id' AS column_name
              UNION ALL SELECT 'sesion', 'usuario_id'
            ),
            expected AS (
              SELECT table_name, column_name FROM por_id_columns
              EXCEPT
              SELECT table_name, column_name FROM excluded
              UNION ALL
              SELECT table_name, column_name FROM extras
            )
            SELECT e.table_name, e.column_name
            FROM expected e
            WHERE NOT EXISTS (
              SELECT 1
              FROM pg_trigger t
              JOIN pg_class c ON c.oid = t.tgrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'fsj'
                AND c.relname = e.table_name
                AND t.tgfoid = 'fsj.assert_actor_activo'::regproc
                AND NOT t.tgisinternal
                AND pg_get_triggerdef(t.oid) LIKE '%''' || e.column_name || '''%'
            )
            ORDER BY 1, 2
          `);

          expect(result.rows, `Uncovered actor columns (missing INV-U07 trigger): ${JSON.stringify(result.rows)}`).toEqual([]);

          // Sanity: the query itself must actually be finding columns, or
          // an empty `rows` above would be a false pass (e.g. a typo'd
          // schema name silently matching nothing).
          const sanity = await tx.query(`
            SELECT count(*)::int AS n
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'fsj' AND c.relkind = 'r'
              AND a.attnum > 0 AND NOT a.attisdropped
              AND a.attname LIKE '%\\_por\\_id' ESCAPE '\\'
          `);
          expect(sanity.rows[0].n).toBeGreaterThan(15);
        }),
      );
    });
  });
});
