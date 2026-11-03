/**
 * DB tests for migrations:
 * - 0114_vencimiento_lote_elaborado (EL5, INV-EL4, INV-S22)
 * - 0115_lote_elaborado_nombre (nombre NOT NULL, aspecto nullable, insert-only)
 * - 0116_pin_elaborar_lote (seed_acciones_con_pin)
 *
 * Covers:
 * - fsj.lote_sigue_a_drogas and fsj.lotes_elaborados_dependientes (transitive: a dilución of a dilución)
 * - INV-EL4: the produced fecha_vencimiento must equal the earliest DROGA vencimiento consumed
 * - reanálisis of the drug moves the dependent lots' vencimiento (and they get no reanalisis_partida row of their own)
 * - INV-S22 refuses re-analysing an elaborated lot and accepts a drug without saldo while a dependent lot still has saldo
 * - 0115: nombre NOT NULL, aspecto nullable, insert-only (UPDATE refused by forbid trigger)
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import {
  asOwner,
  inRollbackTx,
  expectInvariantViolation,
  expectDbRejection,
  setRelojPrueba,
} from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  createUserWithRole,
  insertUnidad,
  insertProveedor,
  crearPartidaConIngreso,
  designarDt,
} from "./fixtures";

const JORNADA_INSTANT = "2026-10-29T12:00:00-03:00";
const FECHA_VENCIMIENTO_DROGA = "2027-06-01";
const FECHA_VENCIMIENTO_EXCIPIENTE = "2027-03-01";
const FECHA_REANALISIS_FUTURA = "2027-12-31";

let migrations0114to0116Applied = false;

beforeAll(async () => {
  if (dbTestSkipReason() !== null) return;
  try {
    await asOwner(async (tx) => {
      const res = await tx.query(
        `SELECT 1 FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
         WHERE nspname = 'fsj' AND proname = 'lote_sigue_a_drogas'`,
      );
      migrations0114to0116Applied = (res.rowCount ?? 0) > 0;
    });
  } catch {
    migrations0114to0116Applied = false;
  }
});

interface SeedVencimientoElaboracion {
  tenantId: string;
  sistema: string;
  dtId: string;
  unidadG: string;
  drogaX: string;
  drogaLactosa: string;
  proveedorId: string;
}

async function insertDrogaWithClase(
  tx: Client,
  tenantId: string,
  unidadId: string,
  nombre: string,
  clase: "DROGA" | "EXCIPIENTE" | "MATERIAL",
): Promise<string> {
  const res = await tx.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, nombre, unidadId, clase],
  );
  return res.rows[0].id as string;
}

async function seedBase(tx: Client): Promise<SeedVencimientoElaboracion> {
  const tenantId = await insertTenant(tx, "elab-0114");
  const sistema = await createSistemaUser(tx, tenantId);
  const dtId = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt-elab");
  await designarDt(tx, tenantId, dtId, sistema);

  const unidadG = await insertUnidad(tx, "g", "MASA", 1);
  const proveedorId = await insertProveedor(tx, tenantId);

  const drogaX = await insertDrogaWithClase(tx, tenantId, unidadG, "Droga X", "DROGA");
  const drogaLactosa = await insertDrogaWithClase(tx, tenantId, unidadG, "Lactosa", "EXCIPIENTE");

  await setRelojPrueba(tx, JORNADA_INSTANT);

  return { tenantId, sistema, dtId, unidadG, drogaX, drogaLactosa, proveedorId };
}

async function insertLoteElaboradoDb(
  tx: Client,
  params: {
    tenantId: string;
    drogaId: string;
    tipo: "DILUCION" | "FORMULA";
    formulaId?: string | null;
    lote: string;
    cantidadProducida: number;
    costoUnitario: number;
    potenciaDeclarada?: number | null;
    fechaVencimiento?: string | null;
    nombre?: string | null;
    aspecto?: string | null;
    elaboradoPorId: string;
    consumos: { partidaId: string; cantidad: number }[];
  },
): Promise<{ partidaId: string; elaboracionLoteId: string }> {
  const resPartida = await tx.query(
    `INSERT INTO fsj.partida (tenant_id, droga_id, origen, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento, potencia_declarada)
     VALUES ($1, $2, 'ELABORACION_PROPIA', NULL, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.tenantId,
      params.drogaId,
      params.lote,
      params.costoUnitario,
      params.cantidadProducida,
      params.fechaVencimiento ?? null,
      params.potenciaDeclarada ?? null,
    ],
  );
  const partidaId = resPartida.rows[0].id as string;

  const resElab = await tx.query(
    `INSERT INTO fsj.elaboracion_lote (tenant_id, partida_id, tipo, formula_id, elaborado_por_id, nombre, aspecto)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.tenantId,
      partidaId,
      params.tipo,
      params.formulaId ?? null,
      params.elaboradoPorId,
      params.nombre,
      params.aspecto ?? null,
    ],
  );
  const elaboracionLoteId = resElab.rows[0].id as string;

  await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id, elaboracion_lote_id)
     VALUES ($1, $2, 'INGRESO_ELABORACION', $3, $4, $5)`,
    [params.tenantId, partidaId, params.cantidadProducida, params.elaboradoPorId, elaboracionLoteId],
  );

  for (const c of params.consumos) {
    await tx.query(
      `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id, elaboracion_lote_id)
       VALUES ($1, $2, 'EGRESO_ELABORACION', $3, $4, $5)`,
      [params.tenantId, c.partidaId, c.cantidad, params.elaboradoPorId, elaboracionLoteId],
    );
  }

  return { partidaId, elaboracionLoteId };
}

describe.skipIf(dbTestSkipReason() !== null)("0114-0116 lotes elaborados vencimiento & nombre DB rules", () => {
  it("fsj.lote_sigue_a_drogas and fsj.lotes_elaborados_dependientes detect transitively dependent lots", async (ctx) => {
    if (!migrations0114to0116Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        // Raw active drug
        const pDroga = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 100,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
        });

        const pLactosa = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaLactosa,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 500,
          fechaVencimiento: FECHA_VENCIMIENTO_EXCIPIENTE,
        });

        // Dilución 1 (1 %): consumes pDroga
        const { partidaId: pDil1 } = await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: "FSJ-DIL-0001",
          nombre: "Droga X 1:100",
          cantidadProducida: 100,
          costoUnitario: 10,
          potenciaDeclarada: 1,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
          elaboradoPorId: seed.sistema,
          consumos: [
            { partidaId: pDroga, cantidad: 1 },
            { partidaId: pLactosa, cantidad: 99 },
          ],
        });

        // Dilución 2 (0.1 %): consumes pDil1 (dilución of dilución)
        const { partidaId: pDil2 } = await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: "FSJ-DIL-0002",
          nombre: "Droga X 1:1000",
          cantidadProducida: 100,
          costoUnitario: 1,
          potenciaDeclarada: 0.1,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
          elaboradoPorId: seed.sistema,
          consumos: [
            { partidaId: pDil1, cantidad: 10 },
            { partidaId: pLactosa, cantidad: 90 },
          ],
        });

        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");

        // Verify lote_sigue_a_drogas
        const resSigueDroga = await tx.query(
          `SELECT fsj.lote_sigue_a_drogas($1, $2) AS sigue`,
          [seed.tenantId, pDroga],
        );
        expect(resSigueDroga.rows[0].sigue).toBe(false);

        const resSigueDil1 = await tx.query(
          `SELECT fsj.lote_sigue_a_drogas($1, $2) AS sigue`,
          [seed.tenantId, pDil1],
        );
        expect(resSigueDil1.rows[0].sigue).toBe(true);

        const resSigueDil2 = await tx.query(
          `SELECT fsj.lote_sigue_a_drogas($1, $2) AS sigue`,
          [seed.tenantId, pDil2],
        );
        expect(resSigueDil2.rows[0].sigue).toBe(true);

        // Verify lotes_elaborados_dependientes (transitive)
        const depsDroga = await tx.query(
          `SELECT partida_id FROM fsj.lotes_elaborados_dependientes($1, $2) ORDER BY partida_id`,
          [seed.tenantId, pDroga],
        );
        const depIds = depsDroga.rows.map((r) => r.partida_id).sort();
        expect(depIds).toEqual([pDil1, pDil2].sort());

        const depsDil1 = await tx.query(
          `SELECT partida_id FROM fsj.lotes_elaborados_dependientes($1, $2)`,
          [seed.tenantId, pDil1],
        );
        expect(depsDil1.rows.map((r) => r.partida_id)).toEqual([pDil2]);
      });
    });
  });

  it("INV-EL4 enforces that produced fecha_vencimiento equals the earliest consumed DROGA vencimiento", async (ctx) => {
    if (!migrations0114to0116Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        const pDroga = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 10,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA, // 2027-06-01
        });

        const pLactosa = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaLactosa,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 500,
          fechaVencimiento: FECHA_VENCIMIENTO_EXCIPIENTE, // 2027-03-01 (ignored because EXCIPIENTE)
        });

        // 1. Trying to set fecha_vencimiento to lactosa's date (2027-03-01) or another date violates INV-EL4
        await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: "FSJ-DIL-0001",
          nombre: "Droga X 1:100",
          cantidadProducida: 100,
          costoUnitario: 10,
          potenciaDeclarada: 1,
          fechaVencimiento: FECHA_VENCIMIENTO_EXCIPIENTE, // 2027-03-01 != 2027-06-01
          elaboradoPorId: seed.sistema,
          consumos: [
            { partidaId: pDroga, cantidad: 1 },
            { partidaId: pLactosa, cantidad: 99 },
          ],
        });

        await expectInvariantViolation(
          tx,
          () => tx.query("SET CONSTRAINTS ALL IMMEDIATE"),
          "INV-EL4",
        );
      });
    });
  });

  it("a reanálisis of the drug moves dependent lots' vencimiento and inserts no reanalisis_partida rows for them", async (ctx) => {
    if (!migrations0114to0116Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        const pDroga = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 50,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
        });

        const pLactosa = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaLactosa,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 500,
          fechaVencimiento: FECHA_VENCIMIENTO_EXCIPIENTE,
        });

        const { partidaId: pDil1 } = await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: "FSJ-DIL-0001",
          nombre: "Droga X 1:100",
          cantidadProducida: 100,
          costoUnitario: 10,
          potenciaDeclarada: 1,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
          elaboradoPorId: seed.sistema,
          consumos: [
            { partidaId: pDroga, cantidad: 1 },
            { partidaId: pLactosa, cantidad: 99 },
          ],
        });

        const { partidaId: pDil2 } = await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: "FSJ-DIL-0002",
          nombre: "Droga X 1:1000",
          cantidadProducida: 100,
          costoUnitario: 1,
          potenciaDeclarada: 0.1,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
          elaboradoPorId: seed.sistema,
          consumos: [
            { partidaId: pDil1, cantidad: 10 },
            { partidaId: pLactosa, cantidad: 90 },
          ],
        });

        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");

        // DT re-analyses the active drug
        await tx.query(
          `INSERT INTO fsj.reanalisis_partida (tenant_id, partida_id, fecha_reanalisis, registrado_por_id)
           VALUES ($1, $2, $3, $4)`,
          [seed.tenantId, pDroga, FECHA_REANALISIS_FUTURA, seed.dtId],
        );

        // Check that drug and both dependent lots have moved to FECHA_REANALISIS_FUTURA
        const resVigentes = await tx.query(
          `SELECT id, fecha_vencimiento_vigente::text FROM fsj.partida WHERE id = ANY($1)`,
          [[pDroga, pDil1, pDil2]],
        );

        for (const row of resVigentes.rows) {
          expect(row.fecha_vencimiento_vigente).toBe(FECHA_REANALISIS_FUTURA);
        }

        // Dependent lots get no reanalisis_partida rows
        const resReanDeps = await tx.query(
          `SELECT COUNT(*)::int AS total FROM fsj.reanalisis_partida WHERE partida_id = ANY($1)`,
          [[pDil1, pDil2]],
        );
        expect(resReanDeps.rows[0].total).toBe(0);
      });
    });
  });

  it("INV-S22 refuses re-analysing an elaborated lot and accepts a drug without saldo while a dependent lot has saldo", async (ctx) => {
    if (!migrations0114to0116Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        const pDroga = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 1,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
        });

        const pLactosa = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaLactosa,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 500,
          fechaVencimiento: FECHA_VENCIMIENTO_EXCIPIENTE,
        });

        // Dilución consumes ALL 1 unit of pDroga: pDroga now has saldo 0
        const { partidaId: pDil } = await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: "FSJ-DIL-0001",
          nombre: "Droga X 1:100",
          cantidadProducida: 100,
          costoUnitario: 10,
          potenciaDeclarada: 1,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
          elaboradoPorId: seed.sistema,
          consumos: [
            { partidaId: pDroga, cantidad: 1 },
            { partidaId: pLactosa, cantidad: 99 },
          ],
        });

        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");

        const saldoDroga = await tx.query(`SELECT cantidad_disponible FROM fsj.partida WHERE id = $1`, [pDroga]);
        expect(Number(saldoDroga.rows[0].cantidad_disponible)).toBe(0);

        // 1. Refuse re-analysing the elaborated lot (pDil)
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.reanalisis_partida (tenant_id, partida_id, fecha_reanalisis, registrado_por_id)
               VALUES ($1, $2, $3, $4)`,
              [seed.tenantId, pDil, FECHA_REANALISIS_FUTURA, seed.dtId],
            ),
          "INV-S22",
        );

        // 2. Accept re-analysing pDroga even though its saldo is 0, because pDil still has saldo
        await tx.query(
          `INSERT INTO fsj.reanalisis_partida (tenant_id, partida_id, fecha_reanalisis, registrado_por_id)
           VALUES ($1, $2, $3, $4)`,
          [seed.tenantId, pDroga, FECHA_REANALISIS_FUTURA, seed.dtId],
        );

        const vigentes = await tx.query(
          `SELECT id, fecha_vencimiento_vigente::text FROM fsj.partida WHERE id = ANY($1)`,
          [[pDroga, pDil]],
        );
        for (const row of vigentes.rows) {
          expect(row.fecha_vencimiento_vigente).toBe(FECHA_REANALISIS_FUTURA);
        }
      });
    });
  });

  it("0115: nombre NOT NULL, aspecto nullable, and forbid_update_delete rejects UPDATE", async (ctx) => {
    if (!migrations0114to0116Applied) {
      ctx.skip();
      return;
    }

    await asOwner(async (client) => {
      await inRollbackTx(client, async (tx) => {
        const seed = await seedBase(tx);

        const pDroga = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 10,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
        });

        const pLactosa = await crearPartidaConIngreso(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaLactosa,
          proveedorId: seed.proveedorId,
          registradoPorId: seed.sistema,
          cantidadInicial: 500,
          fechaVencimiento: FECHA_VENCIMIENTO_EXCIPIENTE,
        });

        // 1. Inserting with nombre = NULL fails NOT NULL constraint
        await expectDbRejection(
          tx,
          () =>
            insertLoteElaboradoDb(tx, {
              tenantId: seed.tenantId,
              drogaId: seed.drogaX,
              tipo: "DILUCION",
              lote: "FSJ-DIL-0001",
              nombre: null,
              cantidadProducida: 100,
              costoUnitario: 10,
              potenciaDeclarada: 1,
              fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
              elaboradoPorId: seed.sistema,
              consumos: [
                { partidaId: pDroga, cantidad: 1 },
                { partidaId: pLactosa, cantidad: 99 },
              ],
            }),
          "23502",
        );

        // 2. Inserting with empty/blank nombre fails check constraint
        await expectDbRejection(
          tx,
          () =>
            insertLoteElaboradoDb(tx, {
              tenantId: seed.tenantId,
              drogaId: seed.drogaX,
              tipo: "DILUCION",
              lote: "FSJ-DIL-0002",
              nombre: "   ",
              cantidadProducida: 100,
              costoUnitario: 10,
              potenciaDeclarada: 1,
              fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
              elaboradoPorId: seed.sistema,
              consumos: [
                { partidaId: pDroga, cantidad: 1 },
                { partidaId: pLactosa, cantidad: 99 },
              ],
            }),
          "23514",
        );

        // 3. Valid insert with aspecto nullable
        const { elaboracionLoteId } = await insertLoteElaboradoDb(tx, {
          tenantId: seed.tenantId,
          drogaId: seed.drogaX,
          tipo: "DILUCION",
          lote: "FSJ-DIL-0003",
          nombre: "Droga X 1:100",
          aspecto: "Polvo fino blanco",
          cantidadProducida: 100,
          costoUnitario: 10,
          potenciaDeclarada: 1,
          fechaVencimiento: FECHA_VENCIMIENTO_DROGA,
          elaboradoPorId: seed.sistema,
          consumos: [
            { partidaId: pDroga, cantidad: 1 },
            { partidaId: pLactosa, cantidad: 99 },
          ],
        });

        // 4. UPDATE is rejected by forbid_update_delete trigger
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `UPDATE fsj.elaboracion_lote SET nombre = 'Otro nombre' WHERE id = $1`,
              [elaboracionLoteId],
            ),
          "P0001",
        );
      });
    });
  });
});
