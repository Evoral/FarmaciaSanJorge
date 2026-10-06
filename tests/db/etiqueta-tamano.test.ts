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
