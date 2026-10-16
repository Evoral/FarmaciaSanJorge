/**
 * DB tests for prisma/migrations/20261015150000_0079_costos_proveedor
 * (docs/specs/costos-proveedor.md): fsj.lista_precio_proveedor (append-only),
 * fsj.costo_proveedor (versioned, INV-CP-001/002) and the permiso
 * `costos.proveedor.gestionar`.
 *
 * Covers CP17 (one vigente per pair; only vigente_hasta can change, once;
 * DELETE refused; RLS isolates tenants; lista append-only; duplicate hash
 * refused) and the part of CP18 that applies at the schema level (writing
 * costos never touches partida / movimiento_stock).
 *
 * NOTE: Migration 0079 is NOT applied to the shared database yet. This file
 * is written against the migration and must not be run until it is applied
 * (`FSJ_DB_TESTS=yes npm run test:db`).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";
import { insertTenant, createSistemaUser, insertUnidad, insertDroga, insertProveedor, crearPartidaConIngreso } from "./fixtures";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

interface Base {
  tenantId: string;
  sistema: string;
  drogaId: string;
  proveedorId: string;
  /** The droga's unidad base (a MASA unit, factor 0.001 = mg). */
  unidadBaseId: string;
  /** The unidad de precio (a MASA unit, factor 1000 = kg). */
  unidadPrecioId: string;
}

async function seedBase(tx: Client, suffix: string): Promise<Base> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const unidadBaseId = await insertUnidad(tx, `${suffix}b`, "MASA", 0.001);
  const unidadPrecioId = await insertUnidad(tx, `${suffix}p`, "MASA", 1000);
  const drogaId = await insertDroga(tx, tenantId, unidadBaseId);
  const proveedorId = await insertProveedor(tx, tenantId);
  return { tenantId, sistema, drogaId, proveedorId, unidadBaseId, unidadPrecioId };
}

interface CostoOverrides {
  drogaId?: string;
  proveedorId?: string;
  precioInformado?: string;
  costoUnitario?: string;
  fechaPrecio?: string;
  descripcionProveedor?: string | null;
  listaPrecioId?: string | null;
  motivo?: string | null;
}

async function insertCosto(tx: Client, base: Base, overrides: CostoOverrides = {}): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.costo_proveedor
       (tenant_id, droga_id, proveedor_id, precio_informado, unidad_precio_id, costo_unitario, fecha_precio, descripcion_proveedor, lista_precio_id, motivo, creado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      base.tenantId,
      overrides.drogaId ?? base.drogaId,
      overrides.proveedorId ?? base.proveedorId,
      overrides.precioInformado ?? "40898",
      base.unidadPrecioId,
      overrides.costoUnitario ?? "0.040898",
      overrides.fechaPrecio ?? "2026-10-01",
      overrides.descripcionProveedor ?? null,
      overrides.listaPrecioId ?? null,
      overrides.motivo ?? null,
      base.sistema,
    ],
  );
  return result.rows[0].id as string;
}

interface ListaOverrides {
  proveedorId?: string;
  formato?: string;
  nombreArchivo?: string;
  hashSha256?: string;
  filasLeidas?: number;
  filasAplicadas?: number;
}

async function insertLista(tx: Client, base: Base, overrides: ListaOverrides = {}): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.lista_precio_proveedor
       (tenant_id, proveedor_id, formato, nombre_archivo, hash_sha256, fecha_lista, filas_leidas, filas_aplicadas, registrado_por_id)
     VALUES ($1, $2, $3, $4, $5, '2026-10-01', $6, $7, $8) RETURNING id`,
    [
      base.tenantId,
      overrides.proveedorId ?? base.proveedorId,
      overrides.formato ?? "XLSX",
      overrides.nombreArchivo ?? "lista.xlsx",
      overrides.hashSha256 ?? HASH_A,
      overrides.filasLeidas ?? 10,
      overrides.filasAplicadas ?? 8,
      base.sistema,
    ],
  );
  return result.rows[0].id as string;
}

/** What the app would do to version a pair: close the vigente and insert the next one at the same instant. */
async function reemplazar(tx: Client, base: Base, vigenteId: string, overrides: CostoOverrides): Promise<string> {
  await tx.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = now() WHERE id = $1`, [vigenteId]);
  return insertCosto(tx, base, overrides);
}

describe.skipIf(dbTestSkipReason() !== null)("0079_costos_proveedor migration (fsj schema)", () => {
  describe("costo_proveedor: at most one vigente per (droga, proveedor) -- R1", () => {
    it("CP17: a SECOND vigente costo for the same pair is rejected (partial unique index)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpuna");
          await insertCosto(tx, base);
          await expectDbRejection(tx, () => insertCosto(tx, base, { precioInformado: "50000" }), "23505");
        }),
      );
    });

    it("another proveedor or another droga may each have their own vigente costo", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpotros");
          const otroProveedor = await insertProveedor(tx, base.tenantId);
          const otraDroga = await insertDroga(tx, base.tenantId, base.unidadBaseId);
          await insertCosto(tx, base);
          await insertCosto(tx, base, { proveedorId: otroProveedor });
          await insertCosto(tx, base, { drogaId: otraDroga });

          const vigentes = await tx.query(`SELECT count(*)::int AS n FROM fsj.costo_proveedor WHERE tenant_id = $1 AND vigente_hasta IS NULL`, [base.tenantId]);
          expect(vigentes.rows[0].n).toBe(3);
        }),
      );
    });

    it("CP4: closing the vigente and inserting the next one at the same instant leaves exactly one vigente", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpversiona");
          const v1 = await insertCosto(tx, base);
          const v2 = await reemplazar(tx, base, v1, { precioInformado: "41000", costoUnitario: "0.041", fechaPrecio: "2026-10-05" });

          const filas = await tx.query(
            `SELECT id, vigente_desde, vigente_hasta FROM fsj.costo_proveedor WHERE tenant_id = $1 AND droga_id = $2 AND proveedor_id = $3 ORDER BY vigente_desde, id`,
            [base.tenantId, base.drogaId, base.proveedorId],
          );
          expect(filas.rows).toHaveLength(2);
          const vigentes = filas.rows.filter((r) => r.vigente_hasta === null);
          expect(vigentes.map((r) => r.id)).toEqual([v2]);
          // The previous version ends exactly when the new one starts (same transaction instant).
          const anterior = filas.rows.find((r) => r.id === v1);
          const nueva = filas.rows.find((r) => r.id === v2);
          expect((anterior!.vigente_hasta as Date).getTime()).toBe((nueva!.vigente_desde as Date).getTime());
        }),
      );
    });

    it("two tenants may each have a vigente costo (the index is per tenant)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const a = await seedBase(tx, "cptenantA");
          const b = await seedBase(tx, "cptenantB");
          expect(await insertCosto(tx, a)).not.toBe(await insertCosto(tx, b));
        }),
      );
    });
  });

  describe("costo_proveedor: INV-CP-001/002 immutability (only vigente_hasta, once) -- R2", () => {
    it("CP17: UPDATE of any column other than vigente_hasta is refused (INV-CP-001)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpinmutable");
          const lista = await insertLista(tx, base);
          const id = await insertCosto(tx, base, { descripcionProveedor: "Acido borico", motivo: "alta" });
          const otraDroga = await insertDroga(tx, base.tenantId, base.unidadBaseId);
          const otroProveedor = await insertProveedor(tx, base.tenantId);

          const cambios: [string, unknown][] = [
            ["precio_informado", "99999"],
            ["costo_unitario", "9.9"],
            ["fecha_precio", "2026-01-01"],
            ["descripcion_proveedor", "Otro texto"],
            ["motivo", "otro motivo"],
            ["lista_precio_id", lista],
            ["unidad_precio_id", base.unidadBaseId],
            ["droga_id", otraDroga],
            ["proveedor_id", otroProveedor],
            ["vigente_desde", new Date("2020-01-01T00:00:00Z")],
            ["creado_por_id", randomUUID()],
          ];
          for (const [columna, valor] of cambios) {
            await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.costo_proveedor SET ${columna} = $1 WHERE id = $2`, [valor, id]), "INV-CP-001");
          }
        }),
      );
    });

    it("changing another column together with vigente_hasta is refused too", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpcombinado");
          const id = await insertCosto(tx, base);
          await expectInvariantViolation(
            tx,
            () => tx.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = now(), precio_informado = 1 WHERE id = $1`, [id]),
            "INV-CP-001",
          );
        }),
      );
    });

    it("closing (vigente_hasta) succeeds once; a SECOND change of vigente_hasta is refused (INV-CP-002)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpcierra");
          const id = await insertCosto(tx, base);
          const cerrada = await tx.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = now() WHERE id = $1`, [id]);
          expect(cerrada.rowCount).toBe(1);

          // A DIFFERENT instant: now() is the same for the whole transaction.
          await expectInvariantViolation(
            tx,
            () => tx.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = now() + interval '1 second' WHERE id = $1`, [id]),
            "INV-CP-002",
          );
          // Even re-writing the same instant is refused: a closed row takes no more UPDATEs.
          await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = now() WHERE id = $1`, [id]), "INV-CP-002");
        }),
      );
    });

    it("reopening a closed costo (vigente_hasta back to NULL) is refused (INV-CP-002)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpreabre");
          const id = await insertCosto(tx, base);
          await tx.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = now() WHERE id = $1`, [id]);
          await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = NULL WHERE id = $1`, [id]), "INV-CP-002");
        }),
      );
    });

    it("vigente_hasta can not be before vigente_desde (CHECK)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpvigencia");
          const id = await insertCosto(tx, base);
          await expectDbRejection(
            tx,
            () => tx.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = vigente_desde - interval '1 second' WHERE id = $1`, [id]),
            "23514",
          );
        }),
      );
    });

    it("CP17: DELETE is refused, even for the owner (INV-IMMUTABLE)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpdelete");
          const id = await insertCosto(tx, base);
          await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.costo_proveedor WHERE id = $1`, [id]), "INV-IMMUTABLE");
        }),
      );
    });

    it("fsj_app can close a costo (UPDATE vigente_hasta) and lock it FOR UPDATE, but can not UPDATE another column nor DELETE (grants)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpgrants");
          const id = await insertCosto(tx, base);

          await tx.query("SET LOCAL ROLE fsj_app");
          await expectDbRejection(tx, () => tx.query(`UPDATE fsj.costo_proveedor SET precio_informado = 1 WHERE id = $1`, [id]), "42501");
          await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.costo_proveedor WHERE id = $1`, [id]), "42501");

          await withTenant(tx, base.tenantId, async (scoped) => {
            // The shape of modules/costos-proveedor/infrastructure/costo-proveedor-repository.ts#lockVigentes: it relies on the column grant to take FOR UPDATE.
            const locked = await scoped.query(
              `SELECT c.id
               FROM fsj.costo_proveedor c
               JOIN unnest($2::uuid[], $3::uuid[]) AS p(droga_id, proveedor_id) ON c.droga_id = p.droga_id AND c.proveedor_id = p.proveedor_id
               WHERE c.tenant_id = $1::uuid AND c.vigente_hasta IS NULL
               ORDER BY c.droga_id, c.proveedor_id
               FOR UPDATE OF c`,
              [base.tenantId, [base.drogaId], [base.proveedorId]],
            );
            expect(locked.rows.map((r) => r.id)).toEqual([id]);

            const cerrada = await scoped.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = now() WHERE id = $1`, [id]);
            expect(cerrada.rowCount).toBe(1);
          });
        }),
      );
    });
  });

  describe("costo_proveedor: CHECKs and foreign keys (R3, R5 data side)", () => {
    it("precio_informado and costo_unitario must be > 0", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpchecks");
          await expectDbRejection(tx, () => insertCosto(tx, base, { precioInformado: "0" }), "23514");
          await expectDbRejection(tx, () => insertCosto(tx, base, { precioInformado: "-5" }), "23514");
          await expectDbRejection(tx, () => insertCosto(tx, base, { costoUnitario: "0" }), "23514");
          await expectDbRejection(tx, () => insertCosto(tx, base, { costoUnitario: "-0.1" }), "23514");
        }),
      );
    });

    it("descripcion_proveedor and motivo may be NULL but not blank", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpblank");
          await expectDbRejection(tx, () => insertCosto(tx, base, { motivo: "   " }), "23514");
          await expectDbRejection(tx, () => insertCosto(tx, base, { descripcionProveedor: "" }), "23514");
          await insertCosto(tx, base, { motivo: "ok", descripcionProveedor: "Acido borico" });
        }),
      );
    });

    it("the droga, proveedor and lista must belong to the SAME tenant (composite FKs); the unidad is a plain FK to the global catalog", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const a = await seedBase(tx, "cpfkA");
          const b = await seedBase(tx, "cpfkB");
          const listaB = await insertLista(tx, b);

          await expectDbRejection(tx, () => insertCosto(tx, a, { drogaId: b.drogaId }), "23503");
          await expectDbRejection(tx, () => insertCosto(tx, a, { proveedorId: b.proveedorId }), "23503");
          await expectDbRejection(tx, () => insertCosto(tx, a, { listaPrecioId: listaB }), "23503");
          await expectDbRejection(
            tx,
            () =>
              tx.query(
                `INSERT INTO fsj.costo_proveedor (tenant_id, droga_id, proveedor_id, precio_informado, unidad_precio_id, costo_unitario, fecha_precio, creado_por_id)
                 VALUES ($1, $2, $3, 1, $4, 1, '2026-10-01', $5)`,
                [a.tenantId, a.drogaId, a.proveedorId, randomUUID(), a.sistema],
              ),
            "23503",
          );
        }),
      );
    });

    it("a costo may point at the lista it came from (same tenant)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cplista");
          const lista = await insertLista(tx, base);
          const id = await insertCosto(tx, base, { listaPrecioId: lista });
          const row = await tx.query(`SELECT lista_precio_id FROM fsj.costo_proveedor WHERE id = $1`, [id]);
          expect(row.rows[0].lista_precio_id).toBe(lista);
        }),
      );
    });
  });

  describe("lista_precio_proveedor: append-only, one file per proveedor (R21)", () => {
    it("CP17: UPDATE and DELETE are refused (INV-IMMUTABLE)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "lisinmutable");
          const id = await insertLista(tx, base);
          await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.lista_precio_proveedor SET filas_aplicadas = 0 WHERE id = $1`, [id]), "INV-IMMUTABLE");
          await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.lista_precio_proveedor WHERE id = $1`, [id]), "INV-IMMUTABLE");
        }),
      );
    });

    it("fsj_app can SELECT/INSERT but has no UPDATE, DELETE or TRUNCATE (grants)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "lisgrants");
          const id = await insertLista(tx, base);
          await tx.query("SET LOCAL ROLE fsj_app");
          await expectDbRejection(tx, () => tx.query(`UPDATE fsj.lista_precio_proveedor SET nombre_archivo = 'x' WHERE id = $1`, [id]), "42501");
          await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.lista_precio_proveedor WHERE id = $1`, [id]), "42501");
          await expectDbRejection(tx, () => tx.query(`TRUNCATE fsj.lista_precio_proveedor`), "42501");
          await withTenant(tx, base.tenantId, async (scoped) => {
            const rows = await scoped.query(`SELECT id FROM fsj.lista_precio_proveedor WHERE id = $1`, [id]);
            expect(rows.rows).toHaveLength(1);
            await scoped.query(
              `INSERT INTO fsj.lista_precio_proveedor (tenant_id, proveedor_id, formato, nombre_archivo, hash_sha256, fecha_lista, filas_leidas, filas_aplicadas, registrado_por_id)
               VALUES ($1, $2, 'XLSX', 'otra.xlsx', $3, '2026-10-02', 1, 1, $4)`,
              [base.tenantId, base.proveedorId, HASH_B, base.sistema],
            );
          });
        }),
      );
    });

    it("CP9: the same file (hash) can not be imported twice for the same proveedor", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "lishash");
          await insertLista(tx, base, { hashSha256: HASH_A });
          await expectDbRejection(tx, () => insertLista(tx, base, { hashSha256: HASH_A, nombreArchivo: "copia.xlsx" }), "23505");
        }),
      );
    });

    it("the same hash is allowed for another proveedor or another tenant; another hash for the same proveedor too", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "lishash2");
          const otroProveedor = await insertProveedor(tx, base.tenantId);
          const otroTenant = await seedBase(tx, "lishash3");
          await insertLista(tx, base, { hashSha256: HASH_A });
          await insertLista(tx, base, { hashSha256: HASH_A, proveedorId: otroProveedor });
          await insertLista(tx, otroTenant, { hashSha256: HASH_A });
          await insertLista(tx, base, { hashSha256: HASH_B });
        }),
      );
    });

    it("CHECKs: formato XLSX|PDF, hash = 64 lowercase hex, filas_aplicadas <= filas_leidas, no negatives, no blank file name", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "lischecks");
          await insertLista(tx, base, { formato: "PDF", hashSha256: "0123456789abcdef".repeat(4) });
          await expectDbRejection(tx, () => insertLista(tx, base, { formato: "XLS", hashSha256: HASH_B }), "23514");
          await expectDbRejection(tx, () => insertLista(tx, base, { hashSha256: "A".repeat(64) }), "23514");
          await expectDbRejection(tx, () => insertLista(tx, base, { hashSha256: "a".repeat(63) }), "23514");
          await expectDbRejection(tx, () => insertLista(tx, base, { hashSha256: "g".repeat(64) }), "23514");
          await expectDbRejection(tx, () => insertLista(tx, base, { hashSha256: HASH_B, filasLeidas: 3, filasAplicadas: 4 }), "23514");
          await expectDbRejection(tx, () => insertLista(tx, base, { hashSha256: HASH_B, filasLeidas: -1, filasAplicadas: 0 }), "23514");
          await expectDbRejection(tx, () => insertLista(tx, base, { hashSha256: HASH_B, filasLeidas: 5, filasAplicadas: -1 }), "23514");
          await expectDbRejection(tx, () => insertLista(tx, base, { hashSha256: HASH_B, nombreArchivo: "  " }), "23514");
          await insertLista(tx, base, { hashSha256: HASH_B, filasLeidas: 0, filasAplicadas: 0 });
        }),
      );
    });

    it("the proveedor must belong to the same tenant (composite FK)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const a = await seedBase(tx, "lisfkA");
          const b = await seedBase(tx, "lisfkB");
          await expectDbRejection(tx, () => insertLista(tx, a, { proveedorId: b.proveedorId }), "23503");
        }),
      );
    });
  });

  describe("RLS: tenants never see each other's rows (INV-T01/T02)", () => {
    it("CP17: tenant B sees neither tenant A's costos nor its listas, and can not insert into tenant A", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const a = await seedBase(tx, "cprlsA");
          const costoA = await insertCosto(tx, a);
          const listaA = await insertLista(tx, a);
          const b = await seedBase(tx, "cprlsB");

          await tx.query("SET LOCAL ROLE fsj_app");
          await withTenant(tx, b.tenantId, async (scoped) => {
            expect((await scoped.query(`SELECT id FROM fsj.costo_proveedor WHERE id = $1`, [costoA])).rows).toHaveLength(0);
            expect((await scoped.query(`SELECT id FROM fsj.lista_precio_proveedor WHERE id = $1`, [listaA])).rows).toHaveLength(0);
            expect((await scoped.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = now() WHERE id = $1`, [costoA])).rowCount).toBe(0);

            await expectDbRejection(
              scoped,
              () =>
                scoped.query(
                  `INSERT INTO fsj.costo_proveedor (tenant_id, droga_id, proveedor_id, precio_informado, unidad_precio_id, costo_unitario, fecha_precio, creado_por_id)
                   VALUES ($1, $2, $3, 1, $4, 1, '2026-10-01', $5)`,
                  [a.tenantId, a.drogaId, a.proveedorId, a.unidadPrecioId, a.sistema],
                ),
              "42501",
            );
          });
          await withTenant(tx, a.tenantId, async (scoped) => {
            expect((await scoped.query(`SELECT id FROM fsj.costo_proveedor WHERE id = $1`, [costoA])).rows).toHaveLength(1);
          });
        }),
      );
    });
  });

  describe("CP18: writing costos never touches stock", () => {
    it("inserting, replacing and closing costos leaves the droga's partidas and movimientos unchanged", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const base = await seedBase(tx, "cpstock");
          await crearPartidaConIngreso(tx, { tenantId: base.tenantId, drogaId: base.drogaId, proveedorId: base.proveedorId, registradoPorId: base.sistema, cantidadInicial: 500 });

          const snapshot = async () => {
            const partidas = await tx.query(
              `SELECT id, costo_unitario::text AS costo_unitario, cantidad_inicial::text AS cantidad_inicial, cantidad_disponible::text AS cantidad_disponible,
                      fecha_vencimiento::text AS fecha_vencimiento, fecha_vencimiento_vigente::text AS fecha_vencimiento_vigente, fecha_apertura
               FROM fsj.partida WHERE tenant_id = $1 AND droga_id = $2 ORDER BY id`,
              [base.tenantId, base.drogaId],
            );
            const movimientos = await tx.query(`SELECT id, tipo, cantidad::text AS cantidad FROM fsj.movimiento_stock WHERE tenant_id = $1 ORDER BY id`, [base.tenantId]);
            return { partidas: partidas.rows, movimientos: movimientos.rows };
          };

          const antes = await snapshot();
          expect(antes.partidas).toHaveLength(1);

          const lista = await insertLista(tx, base);
          const v1 = await insertCosto(tx, base, { listaPrecioId: lista });
          const v2 = await reemplazar(tx, base, v1, { precioInformado: "45000", costoUnitario: "0.045", fechaPrecio: "2026-10-10" });
          await tx.query(`UPDATE fsj.costo_proveedor SET vigente_hasta = now() WHERE id = $1`, [v2]);

          expect(await snapshot()).toEqual(antes);
        }),
      );
    });
  });

  describe("permiso costos.proveedor.gestionar (R36)", () => {
    it("exists in the catalog as `gestion`, with a description for the role editor", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const row = await tx.query(`SELECT categoria, descripcion FROM fsj.permiso WHERE codigo = 'costos.proveedor.gestionar'`);
          expect(row.rows).toHaveLength(1);
          expect(row.rows[0].categoria).toBe("gestion");
          expect((row.rows[0].descripcion as string).length).toBeGreaterThan(0);
        }),
      );
    });

    it("no predefined role holds it on a new farmacia (ADMINISTRADOR gets it as a `gestion` permiso, others through the role editor)", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const tenantId = await insertTenant(tx, "cpperm");
          const row = await tx.query(
            `SELECT r.codigo
             FROM fsj.rol_permiso rp
             JOIN fsj.rol r ON r.tenant_id = rp.tenant_id AND r.id = rp.rol_id
             JOIN fsj.permiso p ON p.id = rp.permiso_id
             WHERE r.tenant_id = $1 AND p.codigo = 'costos.proveedor.gestionar'`,
            [tenantId],
          );
          expect(row.rows).toEqual([]);
        }),
      );
    });
  });
});
