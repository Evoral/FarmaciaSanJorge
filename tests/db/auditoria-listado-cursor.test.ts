/**
 * DB test for cursor (keyset) pagination over `fsj.registro_auditoria`
 * (M03, FASE 3 point 3.11). No prior art in this repo for cursor
 * pagination -- designed from scratch here, alongside
 * `modules/auditoria/infrastructure/auditoria-repository.ts`.
 *
 * Like every other tests/db/*.test.ts file (see
 * tests/db/usuarios-admin.test.ts's module doc comment), this uses raw
 * `pg` + `asOwner` + `inRollbackTx`, NOT the actual
 * `modules/auditoria/infrastructure/auditoria-repository.ts` Prisma
 * function: Prisma opens its OWN connection (via `@prisma/adapter-pg`),
 * so it cannot see rows inserted-but-not-committed on THIS raw `pg`
 * connection's still-open transaction. `queryPage` below reimplements the
 * repository's exact keyset predicate
 * (`(ocurrido_en < :cursorOcurridoEn) OR (ocurrido_en = :cursorOcurridoEn
 * AND id < :cursorId)`, `ORDER BY ocurrido_en DESC, id DESC`,
 * `LIMIT pageSize + 1`) in raw SQL -- what this test proves is that THAT
 * predicate, run against real Postgres, is a correct total-order seek: no
 * duplicates, no gaps, even across rows sharing the exact same
 * `ocurrido_en`. The pure cursor encode/decode logic itself is unit-tested
 * (DB-free) in tests/unit/auditoria-cursor.test.ts.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx } from "./helpers";
import { insertTenant, createSistemaUser } from "./fixtures";
import { encodeCursor, decodeCursor } from "@/modules/auditoria/domain/cursor";

interface RawRow {
  id: string;
  entidad: string;
  accion: string;
  ocurrido_en: Date;
}

/** Inserts one registro_auditoria row with an EXPLICIT ocurrido_en (never `now()`), so two rows can be forced to share the exact same timestamp -- two separate `now()` calls essentially never collide in practice, but this test needs them to. */
async function insertRegistro(
  tx: Client,
  args: { tenantId: string; usuarioId: string; entidad: string; entidadId: string; accion: string; ocurridoEn: string },
): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, ocurrido_en)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [args.tenantId, args.usuarioId, args.entidad, args.entidadId, args.accion, args.ocurridoEn],
  );
  return result.rows[0].id as string;
}

/**
 * Reimplements `listRegistroAuditoria`'s keyset query in raw SQL (see the
 * module doc comment above for why this can't just call the Prisma
 * repository function directly in this harness).
 */
async function queryPage(
  tx: Client,
  args: { tenantId: string; entidad?: string; accion?: string; desde?: string; hasta?: string; cursor?: string; pageSize: number },
): Promise<{ items: RawRow[]; nextCursor: string | null }> {
  const conditions: string[] = ["tenant_id = $1"];
  const values: unknown[] = [args.tenantId];

  if (args.entidad) {
    values.push(args.entidad);
    conditions.push(`entidad = $${values.length}`);
  }
  if (args.accion) {
    values.push(args.accion);
    conditions.push(`accion = $${values.length}::fsj.tipo_accion`);
  }
  if (args.desde) {
    values.push(args.desde);
    conditions.push(`ocurrido_en >= $${values.length}`);
  }
  if (args.hasta) {
    values.push(args.hasta);
    conditions.push(`ocurrido_en <= $${values.length}`);
  }
  if (args.cursor) {
    const decoded = decodeCursor(args.cursor);
    values.push(decoded.ocurridoEn.toISOString());
    const ocurridoEnIdx = values.length;
    values.push(decoded.id);
    const idIdx = values.length;
    conditions.push(`(ocurrido_en < $${ocurridoEnIdx} OR (ocurrido_en = $${ocurridoEnIdx} AND id < $${idIdx}))`);
  }

  values.push(args.pageSize + 1);
  const limitIdx = values.length;

  const result = await tx.query(
    `SELECT id, entidad, accion, ocurrido_en FROM fsj.registro_auditoria
     WHERE ${conditions.join(" AND ")}
     ORDER BY ocurrido_en DESC, id DESC
     LIMIT $${limitIdx}`,
    values,
  );

  const rows = result.rows as RawRow[];
  const hasMore = rows.length > args.pageSize;
  const items = hasMore ? rows.slice(0, args.pageSize) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ ocurridoEn: new Date(last.ocurrido_en), id: last.id }) : null;

  return { items, nextCursor };
}

describe.skipIf(dbTestSkipReason() !== null)("registro_auditoria cursor (keyset) pagination", () => {
  it("paginates through same-timestamp rows with no duplicates and no gaps, in stable (ocurrido_en DESC, id DESC) order", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "cursor");
        const sistema = await createSistemaUser(tx, tenantId);
        const entidadId = randomUUID();

        // Two DIFFERENT timestamps, one of them shared by THREE rows
        // (different ids) -- the exact scenario a ocurrido_en-only cursor
        // would mishandle. Inserted in a deliberately non-sorted order so
        // this test can't accidentally pass just because insertion order
        // happened to match the expected output order.
        const T_SHARED = "2026-01-15T12:00:00.000Z";
        const T_LATER = "2026-01-15T12:00:01.000Z";
        const T_EARLIER = "2026-01-15T11:59:59.000Z";

        const idLater = await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "usuario", entidadId, accion: "CREAR", ocurridoEn: T_LATER });
        const idShared1 = await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "usuario", entidadId, accion: "MODIFICAR", ocurridoEn: T_SHARED });
        const idEarlier = await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "usuario", entidadId, accion: "MODIFICAR", ocurridoEn: T_EARLIER });
        const idShared2 = await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "usuario", entidadId, accion: "MODIFICAR", ocurridoEn: T_SHARED });
        const idShared3 = await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "usuario", entidadId, accion: "MODIFICAR", ocurridoEn: T_SHARED });
        const idOtherEntidad = await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "receta", entidadId: randomUUID(), accion: "CREAR", ocurridoEn: T_LATER });

        const allInsertedIds = [idLater, idShared1, idEarlier, idShared2, idShared3, idOtherEntidad];
        expect(new Set(allInsertedIds).size).toBe(allInsertedIds.length); // sanity: 6 distinct ids

        // Ground truth: direct ORDER BY ocurrido_en DESC, id DESC over
        // EVERYTHING inserted above (no filter, no pagination).
        const truth = await tx.query(
          `SELECT id FROM fsj.registro_auditoria WHERE tenant_id = $1 ORDER BY ocurrido_en DESC, id DESC`,
          [tenantId],
        );
        const truthIds = truth.rows.map((r) => r.id as string);
        expect(truthIds).toHaveLength(6);

        // Paginate with pageSize = 2 (smaller than the 3-row same-timestamp
        // group), following nextCursor until exhausted.
        const collected: string[] = [];
        let cursor: string | undefined;
        let guard = 0;
        do {
          const page = await queryPage(tx, { tenantId, pageSize: 2, cursor });
          expect(page.items.length).toBeLessThanOrEqual(2);
          collected.push(...page.items.map((r) => r.id));
          cursor = page.nextCursor ?? undefined;
          guard += 1;
          expect(guard).toBeLessThan(20); // safety net against an infinite loop bug
        } while (cursor);

        // (a) no duplicates, no missing ids vs. the direct query. Copies
        // (`[...collected]`) before sorting -- `Array#sort` mutates in
        // place, and `collected`'s ORIGINAL (pagination) order is still
        // needed for assertion (b) below.
        expect(collected).toHaveLength(truthIds.length);
        expect(new Set(collected).size).toBe(truthIds.length);
        expect([...collected].sort()).toEqual([...truthIds].sort());

        // (b) stable ordering preserved EXACTLY, including across the
        // same-timestamp group -- collected order must equal truth order,
        // not just the same set.
        expect(collected).toEqual(truthIds);

        // WHY THIS TEST WOULD FAIL IF THE CURSOR ONLY ENCODED ocurrido_en:
        // with pageSize=2, the page boundary falls INSIDE the 3-row
        // T_SHARED group at least once (3 same-timestamp rows can't fit
        // in a page of 2). A cursor carrying only `ocurrido_en` would
        // resume the next page with `WHERE ocurrido_en < T_SHARED`
        // (strict less-than on the timestamp alone) -- which SKIPS every
        // remaining T_SHARED row outright (dropping idShared3, a gap), or
        // with `<=` would REPLAY every T_SHARED row already returned on
        // the previous page (a duplicate) -- either way `collected` above
        // would fail the no-duplicates/no-gaps assertion. Only the
        // composite `(ocurrido_en, id)` keyset predicate can express
        // "strictly after the exact row I last saw" when timestamps
        // collide.
      }),
    );
  });

  it("filters narrow the result set (entidad, accion, date range) while still paginating correctly", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "cursor-filter");
        const sistema = await createSistemaUser(tx, tenantId);
        const entidadId = randomUUID();

        await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "usuario", entidadId, accion: "CREAR", ocurridoEn: "2026-01-01T00:00:00.000Z" });
        await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "usuario", entidadId, accion: "MODIFICAR", ocurridoEn: "2026-02-01T00:00:00.000Z" });
        await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "usuario", entidadId, accion: "MODIFICAR", ocurridoEn: "2026-03-01T00:00:00.000Z" });
        await insertRegistro(tx, { tenantId, usuarioId: sistema, entidad: "receta", entidadId: randomUUID(), accion: "CREAR", ocurridoEn: "2026-02-15T00:00:00.000Z" });

        const byEntidad = await queryPage(tx, { tenantId, entidad: "receta", pageSize: 10 });
        expect(byEntidad.items).toHaveLength(1);
        expect(byEntidad.items[0].entidad).toBe("receta");

        const byAccion = await queryPage(tx, { tenantId, accion: "MODIFICAR", pageSize: 10 });
        expect(byAccion.items).toHaveLength(2);
        expect(byAccion.items.every((r) => r.accion === "MODIFICAR")).toBe(true);

        const byRange = await queryPage(tx, {
          tenantId,
          desde: "2026-01-15T00:00:00.000Z",
          hasta: "2026-02-20T00:00:00.000Z",
          pageSize: 10,
        });
        expect(byRange.items).toHaveLength(2); // the 02-01 usuario row + the 02-15 receta row

        const combined = await queryPage(tx, { tenantId, entidad: "usuario", accion: "MODIFICAR", pageSize: 10 });
        expect(combined.items).toHaveLength(2);
      }),
    );
  });

  it("hasMore/nextCursor is null on the exact last page (pageSize divides the row count evenly)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "cursor-exact");
        const sistema = await createSistemaUser(tx, tenantId);
        const entidadId = randomUUID();

        for (let i = 0; i < 4; i += 1) {
          await insertRegistro(tx, {
            tenantId,
            usuarioId: sistema,
            entidad: "usuario",
            entidadId,
            accion: "MODIFICAR",
            ocurridoEn: `2026-01-0${i + 1}T00:00:00.000Z`,
          });
        }

        const page1 = await queryPage(tx, { tenantId, pageSize: 2 });
        expect(page1.items).toHaveLength(2);
        expect(page1.nextCursor).not.toBeNull();

        const page2 = await queryPage(tx, { tenantId, pageSize: 2, cursor: page1.nextCursor! });
        expect(page2.items).toHaveLength(2);
        expect(page2.nextCursor).toBeNull(); // exactly 4 rows, pageSize 2 -> last page has no "extra" row
      }),
    );
  });
});
