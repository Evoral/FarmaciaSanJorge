/**
 * DB tests for prisma/migrations/.../0031_regla_precio_cotizacion (M08
 * FASE 4 point 4.6, M10 FASE 7 point 7.4). See tests/db/helpers.ts for the
 * rollback-transaction safety model and tests/db/fixtures.ts for the
 * shared seed helpers. Mirrors tests/db/fichas-tecnicas-lineas-pesaje.test.ts
 * and tests/db/fichas-tecnicas-generacion.test.ts's structure/style.
 */
import { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  insertUnidad,
  insertDroga,
  insertPaciente,
  insertMedico,
  insertReceta,
  insertItemReceta,
  insertComponente,
  insertFicha,
  insertLinea,
  insertProveedor,
  crearPartidaConIngreso,
} from "./fixtures";

async function insertRegla(tx: Client, tenantId: string, creadoPorId: string, margen = "300"): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.regla_precio (tenant_id, margen, creado_por_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, margen, creadoPorId],
  );
  return result.rows[0].id as string;
}

async function seedTenantConSistema(tx: Client, suffix: string): Promise<{ tenantId: string; sistema: string }> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  return { tenantId, sistema };
}

async function seedItemConFichaYRegla(tx: Client, suffix: string) {
  const { tenantId, sistema } = await seedTenantConSistema(tx, suffix);
  const unidadId = await insertUnidad(tx, suffix);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  const pacienteId = await insertPaciente(tx, tenantId);
  const medicoId = await insertMedico(tx, tenantId);
  const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
  await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "TOTAL", cantidad: 5 });
  const fichaTecnicaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
  const lineaId = await insertLinea(tx, {
    tenantId,
    fichaTecnicaId,
    drogaId,
    unidadMedidaId: unidadId,
    cantidadTeorica: 5,
    cantidadAPesar: 5,
  });
  const reglaId = await insertRegla(tx, tenantId, sistema);
  return { tenantId, sistema, unidadId, drogaId, itemRecetaId, fichaTecnicaId, lineaId, reglaId };
}

async function insertCotizacion(
  tx: Client,
  input: { tenantId: string; itemRecetaId: string; reglaPrecioId: string; calculadaPorId: string; costoInsumos?: string; margenAplicado?: string; precioFinal?: string },
): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.cotizacion (tenant_id, item_receta_id, costo_insumos, margen_aplicado, precio_final, regla_precio_id, detalle, calculada_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.tenantId,
      input.itemRecetaId,
      input.costoInsumos ?? "10",
      input.margenAplicado ?? "300",
      input.precioFinal ?? "30",
      input.reglaPrecioId,
      JSON.stringify({ lineas: [] }),
      input.calculadaPorId,
    ],
  );
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("0031_regla_precio_cotizacion migration (fsj schema)", () => {
  describe("regla_precio: at most one OPEN (vigente_hasta IS NULL) row per tenant", () => {
    it("a SECOND open regla_precio for the SAME tenant is rejected (partial unique index)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema } = await seedTenantConSistema(tx, "unaabierta");
          await insertRegla(tx, tenantId, sistema, "100");

          await expectDbRejection(tx, () => insertRegla(tx, tenantId, sistema, "200"), "23505");
        }),
      );
    });

    it("closing the current OPEN regla (vigente_hasta) allows a new open one to be inserted right after -- the INV-PR-001 versioning flow", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema } = await seedTenantConSistema(tx, "versiona");
          const v1 = await insertRegla(tx, tenantId, sistema, "100");

          await tx.query(`UPDATE fsj.regla_precio SET vigente_hasta = now() WHERE id = $1`, [v1]);
          const v2 = await insertRegla(tx, tenantId, sistema, "150");

          const abiertas = await tx.query(`SELECT id FROM fsj.regla_precio WHERE tenant_id = $1 AND vigente_hasta IS NULL`, [tenantId]);
          expect(abiertas.rows.map((r) => r.id)).toEqual([v2]);
        }),
      );
    });

    it("two DIFFERENT tenants may each have their own open regla_precio simultaneously (the unique index is per-tenant)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const a = await seedTenantConSistema(tx, "tenantA");
          const b = await seedTenantConSistema(tx, "tenantB");

          const idA = await insertRegla(tx, a.tenantId, a.sistema, "100");
          const idB = await insertRegla(tx, b.tenantId, b.sistema, "200");

          expect(idA).not.toBe(idB);
        }),
      );
    });
  });

  describe("regla_precio: INV-PR-001 immutability (margen/vigente_desde/creado_por_id fixed forever; vigente_hasta settable ONCE)", () => {
    it("UPDATE of margen is rejected", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema } = await seedTenantConSistema(tx, "invpr001a");
          const id = await insertRegla(tx, tenantId, sistema, "100");

          await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.regla_precio SET margen = 999 WHERE id = $1`, [id]), "INV-PR-001");
        }),
      );
    });

    it("closing (setting vigente_hasta) succeeds once, but a SECOND attempt to change vigente_hasta is rejected (cese es final)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema } = await seedTenantConSistema(tx, "invpr001b");
          const id = await insertRegla(tx, tenantId, sistema, "100");

          await tx.query(`UPDATE fsj.regla_precio SET vigente_hasta = now() WHERE id = $1`, [id]);

          // A DIFFERENT instant than the first close -- `now()` alone would
          // resolve to the SAME transaction-start timestamp both times
          // (Postgres `now()` is stable per transaction) and the trigger
          // would see NEW = OLD, i.e. no real change, and let it through.
          await expectInvariantViolation(
            tx,
            () => tx.query(`UPDATE fsj.regla_precio SET vigente_hasta = now() + interval '1 second' WHERE id = $1`, [id]),
            "INV-PR-001",
          );
        }),
      );
    });

    it("DELETE is rejected, even for fsj_owner", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema } = await seedTenantConSistema(tx, "invpr001c");
          const id = await insertRegla(tx, tenantId, sistema, "100");

          await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.regla_precio WHERE id = $1`, [id]), "INV-IMMUTABLE");
        }),
      );
    });

    it("fsj_app can update vigente_hasta but NOT margen, and has no DELETE grant at all (defense in depth)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema } = await seedTenantConSistema(tx, "grantregla");
          const id = await insertRegla(tx, tenantId, sistema, "100");

          await tx.query("SET LOCAL ROLE fsj_app");
          await expectDbRejection(tx, () => tx.query(`UPDATE fsj.regla_precio SET margen = 999 WHERE id = $1`, [id]), "42501");
          await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.regla_precio WHERE id = $1`, [id]), "42501");

          await withTenant(tx, tenantId, async (scoped) => {
            const updated = await scoped.query(`UPDATE fsj.regla_precio SET vigente_hasta = now() WHERE id = $1`, [id]);
            expect(updated.rowCount).toBe(1);
          });
        }),
      );
    });

    it("margen >= 0 (CHECK): a negative margen is rejected", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema } = await seedTenantConSistema(tx, "margennegativo");
          await expectDbRejection(
            tx,
            () => tx.query(`INSERT INTO fsj.regla_precio (tenant_id, margen, creado_por_id) VALUES ($1, -1, $2)`, [tenantId, sistema]),
            "23514",
          );
        }),
      );
    });
  });

  describe("cotizacion: fully insert-only (INV-R06)", () => {
    it("cotizacion cannot be updated or deleted by fsj_app", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema, itemRecetaId, reglaId } = await seedItemConFichaYRegla(tx, "cotgrant");
          const cotId = await insertCotizacion(tx, { tenantId, itemRecetaId, reglaPrecioId: reglaId, calculadaPorId: sistema });

          await tx.query("SET LOCAL ROLE fsj_app");
          await expectDbRejection(tx, () => tx.query(`UPDATE fsj.cotizacion SET precio_final = 999 WHERE id = $1`, [cotId]), "42501");
          await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.cotizacion WHERE id = $1`, [cotId]), "42501");
        }),
      );
    });

    it("cotizacion is immutable at the trigger level too: UPDATE/DELETE rejected even for fsj_owner", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema, itemRecetaId, reglaId } = await seedItemConFichaYRegla(tx, "cotinmutable");
          const cotId = await insertCotizacion(tx, { tenantId, itemRecetaId, reglaPrecioId: reglaId, calculadaPorId: sistema });

          await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.cotizacion SET precio_final = 999 WHERE id = $1`, [cotId]), "INV-IMMUTABLE");
          await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.cotizacion WHERE id = $1`, [cotId]), "INV-IMMUTABLE");
        }),
      );
    });

    it("INV-R06: 'vigente' is the row with the greatest calculada_en -- previous cotizaciones are kept, never overwritten", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema, itemRecetaId, reglaId } = await seedItemConFichaYRegla(tx, "invr06");
          const c1 = await insertCotizacion(tx, { tenantId, itemRecetaId, reglaPrecioId: reglaId, calculadaPorId: sistema, precioFinal: "10" });
          // Ensure a distinct, later calculada_en without relying on clock resolution.
          const c2Result = await tx.query(
            `INSERT INTO fsj.cotizacion (tenant_id, item_receta_id, costo_insumos, margen_aplicado, precio_final, regla_precio_id, detalle, calculada_por_id, calculada_en)
             VALUES ($1, $2, 10, 300, 20, $3, '{"lineas":[]}'::jsonb, $4, now() + interval '1 second') RETURNING id`,
            [tenantId, itemRecetaId, reglaId, sistema],
          );
          const c2 = c2Result.rows[0].id as string;

          const historial = await tx.query(`SELECT id FROM fsj.cotizacion WHERE tenant_id = $1 AND item_receta_id = $2 ORDER BY calculada_en DESC`, [
            tenantId,
            itemRecetaId,
          ]);
          expect(historial.rows.map((r) => r.id)).toEqual([c2, c1]);
          expect(historial.rows).toHaveLength(2);
        }),
      );
    });

    it("cotizacion cannot reference an item_receta from another tenant (composite FK, INV-T02)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { itemRecetaId } = await seedItemConFichaYRegla(tx, "fkA");
          const { tenantId: tenantB, sistema: sistemaB } = await seedTenantConSistema(tx, "fkB");
          const reglaB = await insertRegla(tx, tenantB, sistemaB);

          await expectDbRejection(
            tx,
            () => insertCotizacion(tx, { tenantId: tenantB, itemRecetaId, reglaPrecioId: reglaB, calculadaPorId: sistemaB }),
            "23503",
          );
        }),
      );
    });
  });

  describe("FASE 7 point 7.4 -- INV-R02 'sin efectos': calculating a cotizacion", () => {
    it("touches ZERO rows in movimiento_stock, asiento_recetario, and contador_correlativo, and reserves nothing (no partida locked)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema, drogaId, itemRecetaId, reglaId } = await seedItemConFichaYRegla(tx, "sinefectoscot");

          // A real partida exists (what the costeo would read), but is
          // NEVER locked or written by this test -- only SELECTed, exactly
          // like modules/precios/infrastructure/cotizacion-repository.ts#getPartidasElegiblesDeDroga.
          const proveedorId = await insertProveedor(tx, tenantId);
          await crearPartidaConIngreso(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema, cantidadInicial: 50 });

          const snapshot = async () => {
            const [movimientos, asientos, contadores] = await Promise.all([
              tx.query(`SELECT count(*)::int AS n FROM fsj.movimiento_stock WHERE tenant_id = $1`, [tenantId]),
              tx.query(`SELECT count(*)::int AS n FROM fsj.asiento_recetario WHERE tenant_id = $1`, [tenantId]),
              tx.query(`SELECT count(*)::int AS n, coalesce(sum(ultimo_valor), 0)::text AS suma FROM fsj.contador_correlativo WHERE tenant_id = $1`, [tenantId]),
            ]);
            return {
              movimientos: movimientos.rows[0].n,
              asientos: asientos.rows[0].n,
              contadores: contadores.rows[0].n,
              contadorSumaUltimoValor: contadores.rows[0].suma,
            };
          };

          // movimiento_stock has ONE row already (the INGRESO_COMPRA from
          // crearPartidaConIngreso) -- the guard below is "unchanged
          // before/after cotizar", not "zero absolute".
          const antes = await snapshot();

          // Read partida eligibility exactly like the app would, WITHOUT any lock.
          const partidas = await tx.query(`SELECT id, cantidad_disponible, fecha_vencimiento, costo_unitario FROM fsj.partida WHERE tenant_id = $1 AND droga_id = $2`, [
            tenantId,
            drogaId,
          ]);
          expect(partidas.rows.length).toBeGreaterThan(0);

          // Same two-column write insertCotizacion performs: ONE cotizacion row.
          const cotId = await insertCotizacion(tx, { tenantId, itemRecetaId, reglaPrecioId: reglaId, calculadaPorId: sistema });
          const cotCount = await tx.query(`SELECT count(*)::int AS n FROM fsj.cotizacion WHERE tenant_id = $1`, [tenantId]);
          expect(cotCount.rows[0].n).toBe(1);
          expect(cotId).toBeTruthy();

          const despues = await snapshot();
          expect(despues).toEqual(antes);

          // The partida's own balance is untouched either.
          const partidaDespues = await tx.query(`SELECT cantidad_disponible FROM fsj.partida WHERE id = $1`, [partidas.rows[0].id]);
          expect(partidaDespues.rows[0].cantidad_disponible).toBe(partidas.rows[0].cantidad_disponible);
        }),
      );
    });

    it("calculating a SECOND cotizacion (history) still touches zero rows in movimiento_stock/asiento_recetario/contador_correlativo", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId, sistema, itemRecetaId, reglaId } = await seedItemConFichaYRegla(tx, "sinefectoscot2");
          await insertCotizacion(tx, { tenantId, itemRecetaId, reglaPrecioId: reglaId, calculadaPorId: sistema });

          const antes = await tx.query(
            `SELECT (SELECT count(*) FROM fsj.movimiento_stock WHERE tenant_id = $1) AS movimientos,
                    (SELECT count(*) FROM fsj.asiento_recetario WHERE tenant_id = $1) AS asientos`,
            [tenantId],
          );

          await insertCotizacion(tx, { tenantId, itemRecetaId, reglaPrecioId: reglaId, calculadaPorId: sistema });

          const despues = await tx.query(
            `SELECT (SELECT count(*) FROM fsj.movimiento_stock WHERE tenant_id = $1) AS movimientos,
                    (SELECT count(*) FROM fsj.asiento_recetario WHERE tenant_id = $1) AS asientos`,
            [tenantId],
          );
          expect(despues.rows[0]).toEqual(antes.rows[0]);
        }),
      );
    });
  });

  describe("cross-tenant isolation (INV-T01/T02)", () => {
    it("tenant B never sees tenant A's regla_precio or cotizacion", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { tenantId: tenantA, sistema, itemRecetaId, reglaId } = await seedItemConFichaYRegla(tx, "isoA");
          const cotId = await insertCotizacion(tx, { tenantId: tenantA, itemRecetaId, reglaPrecioId: reglaId, calculadaPorId: sistema });

          const tenantB = await insertTenant(tx, "isoB");

          await tx.query("SET LOCAL ROLE fsj_app");
          await withTenant(tx, tenantB, async (scoped) => {
            const reglas = await scoped.query(`SELECT id FROM fsj.regla_precio WHERE id = $1`, [reglaId]);
            expect(reglas.rows).toHaveLength(0);
            const cotizaciones = await scoped.query(`SELECT id FROM fsj.cotizacion WHERE id = $1`, [cotId]);
            expect(cotizaciones.rows).toHaveLength(0);
          });
        }),
      );
    });
  });
});
