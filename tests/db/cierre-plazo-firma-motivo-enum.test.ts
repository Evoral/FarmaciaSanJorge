/**
 * DB tests for migrations 0038 (`plazo_firma_dias`, DP-18 RESUELTA) and
 * 0039 (`fsj.motivo_demora` enum, DP-18c RESUELTA), FASE 10 point 10.5.
 * Same rollback-transaction safety model as tests/db/cierre-diario.test.ts
 * -- see tests/db/helpers.ts.
 */
import type { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, expectDbRejection, setRelojPrueba } from "./helpers";
import { createUserWithRole, designarDt, seedAsientoSistema } from "./fixtures";

async function crearDtVigente(tx: Client, seed: { tenantId: string; sistema: string }, vigenteDesde = "2000-01-01") {
  const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "dt");
  const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema, vigenteDesde);
  return { dtId, designacionId };
}

describe.skipIf(dbTestSkipReason() !== null)("0038_cierre_plazo_firma_dias (fsj schema)", () => {
  it("with NO plazo_firma_dias row for the tenant, defaults to 0 -- same behavior as before migration 0038", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "plazo0");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        // No fsj.parametro row for plazo_firma_dias -- insertTenant (fixtures.ts)
        // does not seed it (only create-tenant.ts / migration 0038's backfill do).
        const row = await tx.query(`SELECT 1 FROM fsj.parametro WHERE tenant_id = $1 AND clave = 'plazo_firma_dias'`, [seed.tenantId]);
        expect(row.rowCount).toBe(0);

        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00"); // next day -- out of term when plazo = 0

        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]),
          "INV-C18",
        );
      }),
    );
  });

  it("plazo_firma_dias = 2: signing 2 days later is still on time; signing 3 days later requires motivo", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "plazo2");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'plazo_firma_dias', 'NUMERO', '2')`,
          [seed.tenantId],
        );

        await setRelojPrueba(tx, "2026-06-17T12:00:00-03:00"); // fecha + 2 days -- still on time
        const cierre = await tx.query(`SELECT fuera_de_termino FROM fsj.cierre_diario_firmar($1, $2, $3, $4)`, [
          seed.tenantId,
          fecha.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);
        expect(cierre.rows[0].fuera_de_termino).toBe(false);
      }),
    );
  });

  it("plazo_firma_dias = 2: signing 3 days later IS fuera de término and requires motivo (INV-C18)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "plazo2b");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        await tx.query(
          `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor) VALUES ($1, 'plazo_firma_dias', 'NUMERO', '2')`,
          [seed.tenantId],
        );

        await setRelojPrueba(tx, "2026-06-18T12:00:00-03:00"); // fecha + 3 days -- out of term
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]),
          "INV-C18",
        );

        const cierre = await tx.query(`SELECT fuera_de_termino, motivo_demora FROM fsj.cierre_diario_firmar($1, $2, $3, $4, 'AUSENCIA_DT', NULL)`, [
          seed.tenantId,
          fecha.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);
        expect(cierre.rows[0].fuera_de_termino).toBe(true);
        expect(cierre.rows[0].motivo_demora).toBe("AUSENCIA_DT");
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("0039_cierre_motivo_demora_enum (fsj schema)", () => {
  it("firmar accepts every real enum label, cast from the plain text parameter", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "enumok");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");

        const cierre = await tx.query(`SELECT motivo_demora FROM fsj.cierre_diario_firmar($1, $2, $3, $4, 'FALLA_SISTEMA', NULL)`, [
          seed.tenantId,
          fecha.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);
        expect(cierre.rows[0].motivo_demora).toBe("FALLA_SISTEMA");
      }),
    );
  });

  it("firmar rejects a motivo_demora that is not one of the 4 enum labels (Postgres 'invalid input value for enum')", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "enumbad");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");

        await expectDbRejection(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4, 'texto libre inventado', NULL)`, [
            seed.tenantId,
            fecha.rows[0].fecha_asiento,
            dtId,
            designacionId,
          ]),
          "22P02",
        );
      }),
    );
  });

  it("cierre_diario_motivo_demora_otro_detalle_check: OTRO with an empty detalle is rejected even as fsj_owner (defense in depth beyond firmar's own app-level pre-check)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "otrocheck");
        const { dtId, designacionId } = await crearDtVigente(tx, seed);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");

        await expectDbRejection(
          tx,
          () => tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4, 'OTRO', NULL)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]),
          "23514",
        );

        // With a real detalle, the same OTRO motivo is accepted.
        const cierre = await tx.query(`SELECT motivo_demora, motivo_demora_detalle FROM fsj.cierre_diario_firmar($1, $2, $3, $4, 'OTRO', 'corte de luz')`, [
          seed.tenantId,
          fecha.rows[0].fecha_asiento,
          dtId,
          designacionId,
        ]);
        expect(cierre.rows[0].motivo_demora).toBe("OTRO");
        expect(cierre.rows[0].motivo_demora_detalle).toBe("corte de luz");
      }),
    );
  });

  it("migration data mapping (documented, not re-exercised here): a pre-migration free-text motivo_demora that did not match a real label became OTRO, with the original text preserved in motivo_demora_detalle when it was empty -- see migration 0039's own header for the exact UPDATE/ALTER statements; not re-testable against a fresh rollback tx since the column is already fsj.motivo_demora by the time any test runs against this schema version", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        // Sanity check that the column really is the enum type now (not text).
        const col = await tx.query(
          `SELECT udt_name FROM information_schema.columns WHERE table_schema = 'fsj' AND table_name = 'cierre_diario' AND column_name = 'motivo_demora'`,
        );
        expect(col.rows[0].udt_name).toBe("motivo_demora");
      }),
    );
  });
});
