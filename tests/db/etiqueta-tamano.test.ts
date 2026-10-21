/**
 * DB tests for prisma/migrations/.../0066_etiqueta_tamano: the per-tenant list
 * of page sizes (mm) etiquetas are printed on. See tests/db/helpers.ts for the
 * rollback-transaction safety model.
 *
 * Rows are seeded as the migration owner (which bypasses RLS) and the
 * runtime behavior is then exercised with `SET LOCAL ROLE fsj_app` +
 * `withTenant`, the same technique tests/db/tenant-parametro.test.ts uses.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectDbRejection } from "./helpers";
import { insertTenant } from "./fixtures";

async function insertTamano(tx: Client, tenantId: string, input: { nombre: string; ancho?: number; alto?: number; activo?: boolean }): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.etiqueta_tamano (tenant_id, nombre, ancho_mm, alto_mm, activo) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
    tenantId,
    input.nombre,
    input.ancho ?? 100,
    input.alto ?? 42,
    input.activo ?? true,
  ]);
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("0066_etiqueta_tamano migration (fsj schema)", () => {
  it("stores measures with one decimal and defaults activo/timestamps", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "etq-1");
        const id = await insertTamano(tx, tenantId, { nombre: "Frasco chico", ancho: 62.5, alto: 29.7 });
        const row = await tx.query(`SELECT ancho_mm::text AS ancho, alto_mm::text AS alto, activo, created_at, updated_at FROM fsj.etiqueta_tamano WHERE id = $1`, [id]);
        expect(row.rows[0].ancho).toBe("62.5");
        expect(row.rows[0].alto).toBe("29.7");
        expect(row.rows[0].activo).toBe(true);
        expect(row.rows[0].created_at).toBeInstanceOf(Date);
        expect(row.rows[0].updated_at).toBeInstanceOf(Date);
      }),
    );
  });

  it("CHECK: ancho/alto must be within 10..300 mm", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "etq-2");
        await insertTamano(tx, tenantId, { nombre: "Minimo", ancho: 10, alto: 10 });
        await insertTamano(tx, tenantId, { nombre: "Maximo", ancho: 300, alto: 300 });
        await expectDbRejection(tx, () => insertTamano(tx, tenantId, { nombre: "Ancho chico", ancho: 9.9 }), "23514");
        await expectDbRejection(tx, () => insertTamano(tx, tenantId, { nombre: "Ancho grande", ancho: 300.1 }), "23514");
        await expectDbRejection(tx, () => insertTamano(tx, tenantId, { nombre: "Alto chico", alto: 9.9 }), "23514");
        await expectDbRejection(tx, () => insertTamano(tx, tenantId, { nombre: "Alto grande", alto: 300.1 }), "23514");
      }),
    );
  });

  it("CHECK: nombre can not be blank", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "etq-3");
        await expectDbRejection(tx, () => insertTamano(tx, tenantId, { nombre: "   " }), "23514");
      }),
    );
  });

  it("nombre is unique per tenant, case-insensitively; another tenant may reuse it", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "etq-4a");
        const tenantB = await insertTenant(tx, "etq-4b");
        await insertTamano(tx, tenantA, { nombre: "Rollo chico" });
        await expectDbRejection(tx, () => insertTamano(tx, tenantA, { nombre: "rollo CHICO" }), "23505");
        await expect(insertTamano(tx, tenantB, { nombre: "Rollo chico" })).resolves.toBeTruthy();
      }),
    );
  });

  it("RLS: a tenant only sees its own sizes and can not insert for another tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "etq-5a");
        const tenantB = await insertTenant(tx, "etq-5b");
        const idA = await insertTamano(tx, tenantA, { nombre: "De A" });
        await insertTamano(tx, tenantB, { nombre: "De B" });

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantB, async (scoped) => {
          const visibles = await scoped.query(`SELECT nombre FROM fsj.etiqueta_tamano`);
          expect(visibles.rows.map((r) => r.nombre)).toEqual(["De B"]);
          expect((await scoped.query(`SELECT id FROM fsj.etiqueta_tamano WHERE id = $1`, [idA])).rows).toHaveLength(0);
          await expectDbRejection(scoped, () => insertTamano(scoped, tenantA, { nombre: "Intruso" }), "42501");
        });
      }),
    );
  });

  it("fsj_app: SELECT/INSERT, UPDATE only of the editable columns, no DELETE", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "etq-6");
        const otherTenant = await insertTenant(tx, "etq-6b");
        const id = await insertTamano(tx, tenantId, { nombre: "Editable" });

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (scoped) => {
          await scoped.query(`UPDATE fsj.etiqueta_tamano SET nombre = 'Renombrado', ancho_mm = 50, alto_mm = 30, activo = false, updated_at = now() WHERE id = $1`, [id]);
          const row = await scoped.query(`SELECT nombre, activo FROM fsj.etiqueta_tamano WHERE id = $1`, [id]);
          expect(row.rows[0]).toMatchObject({ nombre: "Renombrado", activo: false });

          await expectDbRejection(scoped, () => scoped.query(`UPDATE fsj.etiqueta_tamano SET created_at = now() WHERE id = $1`, [id]), "42501");
          await expectDbRejection(scoped, () => scoped.query(`UPDATE fsj.etiqueta_tamano SET tenant_id = $2 WHERE id = $1`, [id, otherTenant]), "42501");
          await expectDbRejection(scoped, () => scoped.query(`DELETE FROM fsj.etiqueta_tamano WHERE id = $1`, [id]), "42501");
        });
      }),
    );
  });

  it("INV-T03: tenant_id can not change even for the migration owner", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "etq-7a");
        const tenantB = await insertTenant(tx, "etq-7b");
        const id = await insertTamano(tx, tenantA, { nombre: "Fijo" });
        await expectDbRejection(tx, () => tx.query(`UPDATE fsj.etiqueta_tamano SET tenant_id = $2 WHERE id = $1`, [id, tenantB]), "P0001");
      }),
    );
  });
});

async function insertHoja(tx: Client, tenantId: string, input: { ancho?: number; alto?: number; margen?: number } = {}): Promise<void> {
  await tx.query(`INSERT INTO fsj.etiqueta_hoja (tenant_id, ancho_mm, alto_mm, margen_mm) VALUES ($1, $2, $3, $4)`, [tenantId, input.ancho ?? 210, input.alto ?? 297, input.margen ?? 5]);
}

describe.skipIf(dbTestSkipReason() !== null)("0096_etiqueta_hoja migration (fsj schema)", () => {
  it("seed: every existing tenant has its sheet row", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const sinHoja = await tx.query(`SELECT count(*)::int AS n FROM fsj.tenant t WHERE NOT EXISTS (SELECT 1 FROM fsj.etiqueta_hoja h WHERE h.tenant_id = t.id)`);
        expect(sinHoja.rows[0].n).toBe(0);
        const a4 = await tx.query(`SELECT count(*)::int AS n FROM fsj.etiqueta_hoja WHERE ancho_mm = 210 AND alto_mm = 297 AND margen_mm = 5`);
        expect(a4.rows[0].n).toBeGreaterThan(0);
      }),
    );
  });

  it("stores measures with one decimal; one row per tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "hoja-1");
        await insertHoja(tx, tenantId, { ancho: 215.9, alto: 279.4, margen: 4.5 });
        const row = await tx.query(`SELECT ancho_mm::text AS ancho, alto_mm::text AS alto, margen_mm::text AS margen, updated_at FROM fsj.etiqueta_hoja WHERE tenant_id = $1`, [tenantId]);
        expect(row.rows[0]).toMatchObject({ ancho: "215.9", alto: "279.4", margen: "4.5" });
        expect(row.rows[0].updated_at).toBeInstanceOf(Date);
        await expectDbRejection(tx, () => insertHoja(tx, tenantId), "23505");
      }),
    );
  });

  it("CHECK: sheet 50..500 mm, margin 0..30 mm", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const minimo = await insertTenant(tx, "hoja-2a");
        const maximo = await insertTenant(tx, "hoja-2b");
        await insertHoja(tx, minimo, { ancho: 50, alto: 50, margen: 0 });
        await insertHoja(tx, maximo, { ancho: 500, alto: 500, margen: 30 });
        const otro = await insertTenant(tx, "hoja-2c");
        await expectDbRejection(tx, () => insertHoja(tx, otro, { ancho: 49.9 }), "23514");
        await expectDbRejection(tx, () => insertHoja(tx, otro, { ancho: 500.1 }), "23514");
        await expectDbRejection(tx, () => insertHoja(tx, otro, { alto: 49.9 }), "23514");
        await expectDbRejection(tx, () => insertHoja(tx, otro, { alto: 500.1 }), "23514");
        await expectDbRejection(tx, () => insertHoja(tx, otro, { margen: -0.1 }), "23514");
        await expectDbRejection(tx, () => insertHoja(tx, otro, { margen: 30.1 }), "23514");
      }),
    );
  });

  it("CHECK: the printable area keeps at least 10 mm each way", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const justo = await insertTenant(tx, "hoja-3a");
        await insertHoja(tx, justo, { ancho: 50, alto: 50, margen: 20 });
        const otro = await insertTenant(tx, "hoja-3b");
        await expectDbRejection(tx, () => insertHoja(tx, otro, { ancho: 50, alto: 50, margen: 20.1 }), "23514");
        await expectDbRejection(tx, () => insertHoja(tx, otro, { ancho: 500, alto: 50, margen: 25 }), "23514");
        await expectDbRejection(tx, () => insertHoja(tx, otro, { ancho: 50, alto: 500, margen: 25 }), "23514");
      }),
    );
  });

  it("RLS: a tenant only sees its own sheet and can not insert for another tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "hoja-4a");
        const tenantB = await insertTenant(tx, "hoja-4b");
        await insertHoja(tx, tenantA, { margen: 7 });
        await insertHoja(tx, tenantB, { margen: 9 });

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantB, async (scoped) => {
          const visibles = await scoped.query(`SELECT margen_mm::text AS margen FROM fsj.etiqueta_hoja`);
          expect(visibles.rows.map((r) => r.margen)).toEqual(["9.0"]);
          expect((await scoped.query(`SELECT 1 FROM fsj.etiqueta_hoja WHERE tenant_id = $1`, [tenantA])).rows).toHaveLength(0);
          await expectDbRejection(scoped, () => insertHoja(scoped, tenantA), "42501");
        });
      }),
    );
  });

  it("fsj_app: SELECT/INSERT, UPDATE only of the editable columns, no DELETE", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "hoja-5");
        const otherTenant = await insertTenant(tx, "hoja-5b");

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (scoped) => {
          await insertHoja(scoped, tenantId);
          await scoped.query(`UPDATE fsj.etiqueta_hoja SET ancho_mm = 297, alto_mm = 210, margen_mm = 0, updated_at = now() WHERE tenant_id = $1`, [tenantId]);
          const row = await scoped.query(`SELECT ancho_mm::text AS ancho, margen_mm::text AS margen FROM fsj.etiqueta_hoja WHERE tenant_id = $1`, [tenantId]);
          expect(row.rows[0]).toMatchObject({ ancho: "297.0", margen: "0.0" });

          await expectDbRejection(scoped, () => scoped.query(`UPDATE fsj.etiqueta_hoja SET tenant_id = $2 WHERE tenant_id = $1`, [tenantId, otherTenant]), "42501");
          await expectDbRejection(scoped, () => scoped.query(`DELETE FROM fsj.etiqueta_hoja WHERE tenant_id = $1`, [tenantId]), "42501");
        });
      }),
    );
  });

  it("INV-T03: tenant_id can not change even for the migration owner", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "hoja-6a");
        const tenantB = await insertTenant(tx, "hoja-6b");
        await insertHoja(tx, tenantA);
        await expectDbRejection(tx, () => tx.query(`UPDATE fsj.etiqueta_hoja SET tenant_id = $2 WHERE tenant_id = $1`, [tenantA, tenantB]), "P0001");
      }),
    );
  });
});
