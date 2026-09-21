/**
 * DB tests for prisma/migrations/*_0006_unidades_medida.
 *
 * fsj.unidad_medida is a GLOBAL catalog (DP-39 RESUELTA) -- no tenant_id,
 * no RLS, so these tests never need `withTenant`. See tests/db/helpers.ts
 * for the rollback-transaction safety model.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation, expectDbRejection } from "./helpers";

interface UnidadInput {
  codigo: string;
  nombre?: string;
  simbolo?: string;
  tipoMagnitud: "MASA" | "VOLUMEN" | "UNIDADES";
  factorABase: number;
  esBase?: boolean;
}

async function insertUnidad(tx: Client, input: UnidadInput): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.codigo,
      input.nombre ?? input.codigo,
      input.simbolo ?? input.codigo.slice(0, 3),
      input.tipoMagnitud,
      input.factorABase,
      input.esBase ?? false,
    ],
  );
  return result.rows[0].id as string;
}

function uniq(suffix: string): string {
  return `TEST-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

describe.skipIf(dbTestSkipReason() !== null)("0006_unidades_medida migration (fsj schema)", () => {
  it("seed: MASA/VOLUMEN/UNIDADES base units exist with factor 1, and non-base units convert correctly", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const gramo = await tx.query(`SELECT factor_a_base, es_base FROM fsj.unidad_medida WHERE codigo = 'GRAMO'`);
        expect(gramo.rows[0].es_base).toBe(true);
        expect(Number(gramo.rows[0].factor_a_base)).toBe(1);

        const mililitro = await tx.query(`SELECT factor_a_base, es_base FROM fsj.unidad_medida WHERE codigo = 'MILILITRO'`);
        expect(mililitro.rows[0].es_base).toBe(true);

        const unidad = await tx.query(`SELECT factor_a_base, es_base FROM fsj.unidad_medida WHERE codigo = 'UNIDAD'`);
        expect(unidad.rows[0].es_base).toBe(true);
      }),
    );
  });

  it("INV-M02: a second base unit for an already-based tipo_magnitud is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        // MASA already has a base unit (GRAMO, seeded). A second one must fail.
        await expectDbRejection(
          tx,
          () => insertUnidad(tx, { codigo: uniq("masa-base-2"), tipoMagnitud: "MASA", factorABase: 1, esBase: true }),
          "23505",
        );
      }),
    );
  });

  it("INV-M02: a base unit must have factor_a_base = 1 (check constraint)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await expectDbRejection(
          tx,
          () => insertUnidad(tx, { codigo: uniq("unidades-base-bad"), tipoMagnitud: "UNIDADES", factorABase: 2, esBase: true }),
          "23514",
        );
      }),
    );
  });

  it("INV-M02: a non-base unit with any positive factor is allowed (no uniqueness constraint outside es_base)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const id = await insertUnidad(tx, { codigo: uniq("masa-extra"), tipoMagnitud: "MASA", factorABase: 500 });
        expect(id).toBeTruthy();
      }),
    );
  });

  it("factor_a_base must be strictly positive", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        // Each is savepoint-wrapped (via expectDbRejection) so the second
        // insert genuinely re-exercises the check constraint instead of
        // riding on the first insert's aborted transaction.
        await expectDbRejection(
          tx,
          () => insertUnidad(tx, { codigo: uniq("masa-neg"), tipoMagnitud: "MASA", factorABase: -1 }),
          "23514",
        );
        await expectDbRejection(
          tx,
          () => insertUnidad(tx, { codigo: uniq("masa-zero"), tipoMagnitud: "MASA", factorABase: 0 }),
          "23514",
        );
      }),
    );
  });

  it("INV-M03: unidad_medida rows are never deleted (generic forbid_delete)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const id = await insertUnidad(tx, { codigo: uniq("del"), tipoMagnitud: "UNIDADES", factorABase: 1 });
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.unidad_medida WHERE id = $1`, [id]), "INV-IMMUTABLE");
      }),
    );
  });

  it("INV-M04: factor_a_base and tipo_magnitud become immutable once fsj.unidad_medida_marcar_usada() has run", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const id = await insertUnidad(tx, { codigo: uniq("m04"), tipoMagnitud: "MASA", factorABase: 7 });

        // Before use: editable.
        await tx.query(`UPDATE fsj.unidad_medida SET factor_a_base = 8 WHERE id = $1`, [id]);

        await tx.query(`SELECT fsj.unidad_medida_marcar_usada($1)`, [id]);
        const usedRow = await tx.query(`SELECT usada FROM fsj.unidad_medida WHERE id = $1`, [id]);
        expect(usedRow.rows[0].usada).toBe(true);

        // Savepoint-wrapped (via expectInvariantViolation) so the second
        // assertion below genuinely re-exercises the trigger for
        // tipo_magnitud instead of observing the first violation's aborted
        // transaction (see tests/db/helpers.ts's aborted-transaction rule).
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.unidad_medida SET factor_a_base = 9 WHERE id = $1`, [id]),
          "INV-M04",
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.unidad_medida SET tipo_magnitud = 'VOLUMEN' WHERE id = $1`, [id]),
          "INV-M04",
        );
      }),
    );
  });

  it("INV-M04: usada cannot revert to false once set", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const id = await insertUnidad(tx, { codigo: uniq("m04rev"), tipoMagnitud: "MASA", factorABase: 3 });
        await tx.query(`SELECT fsj.unidad_medida_marcar_usada($1)`, [id]);

        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.unidad_medida SET usada = false WHERE id = $1`, [id]), "INV-M04");
      }),
    );
  });

  it("fsj_app cannot UPDATE the `usada` column directly (only the SECURITY DEFINER helper can)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const id = await insertUnidad(tx, { codigo: uniq("m04grant"), tipoMagnitud: "MASA", factorABase: 3 });

        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(tx, () => tx.query(`UPDATE fsj.unidad_medida SET usada = true WHERE id = $1`, [id]), "42501");
      }),
    );
  });

  it("fsj.convertir(): converts correctly within the same tipo_magnitud (mg -> g)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const mg = await tx.query(`SELECT id FROM fsj.unidad_medida WHERE codigo = 'MILIGRAMO'`);
        const g = await tx.query(`SELECT id FROM fsj.unidad_medida WHERE codigo = 'GRAMO'`);

        const result = await tx.query(`SELECT fsj.convertir(1000, $1, $2) AS v`, [mg.rows[0].id, g.rows[0].id]);
        expect(Number(result.rows[0].v)).toBe(1);
      }),
    );
  });

  it("fsj.convertir(): raises INV-M01 across different tipo_magnitud", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const g = await tx.query(`SELECT id FROM fsj.unidad_medida WHERE codigo = 'GRAMO'`);
        const mL = await tx.query(`SELECT id FROM fsj.unidad_medida WHERE codigo = 'MILILITRO'`);

        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.convertir(1, $1, $2) AS v`, [g.rows[0].id, mL.rows[0].id]),
          "INV-M01",
        );
      }),
    );
  });

  it("fsj.convertir(): raises INV-M01 for a non-existent unit id", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const g = await tx.query(`SELECT id FROM fsj.unidad_medida WHERE codigo = 'GRAMO'`);
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.convertir(1, $1, $2) AS v`, [g.rows[0].id, randomUUID()]),
          "INV-M01",
        );
      }),
    );
  });
});
