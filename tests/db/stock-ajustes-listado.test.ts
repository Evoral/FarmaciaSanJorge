/**
 * DB test for `/stock/ajustes`' listing:
 * `modules/stock/infrastructure/partida-repository.ts#listAjustes` filters,
 * orders and paginates entirely in SQL.
 *
 * Same approach as tests/db/stock-drogas-filtros.test.ts: it runs the
 * repository's OWN statement (`listAjustesSql`) on the raw `pg` connection,
 * since Prisma's connection could not see the rows this test inserts inside
 * its never-committed transaction. Every test runs inside `inRollbackTx` --
 * nothing is ever committed.
 *
 * `registrado_en` is set explicitly on each AJUSTE so the jornada filter is
 * deterministic; the tenant uses the default zona horaria
 * (America/Argentina/Mendoza, UTC-3).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx } from "./helpers";
import { insertTenant, createSistemaUser, createUserWithRole, designarDt, insertProveedor, crearPartidaConIngreso, FUTURO } from "./fixtures";
import { listAjustesSql, type ListAjustesFilter, type ListAjustesRow } from "@/modules/stock/infrastructure/partida-repository";

interface Escenario {
  tenantId: string;
  listar: (filter?: Partial<ListAjustesFilter>) => Promise<{ observaciones: string[]; total: number; rows: ListAjustesRow[] }>;
}

async function unidadId(tx: Client, codigo: string): Promise<string> {
  const result = await tx.query(`SELECT id FROM fsj.unidad_medida WHERE codigo = $1`, [codigo]);
  return result.rows[0].id as string;
}

async function insertDroga(tx: Client, tenantId: string, nombre: string, unidad: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id) VALUES ($1, $2, $3) RETURNING id`, [tenantId, nombre, unidad]);
  return result.rows[0].id as string;
}

async function insertAjuste(
  tx: Client,
  input: { tenantId: string; partidaId: string; motivo: string; observacion: string; registradoEn: string; registradoPorId: string; autorizadoPorId: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, motivo_ajuste, observacion, registrado_por_id, autorizado_por_id, registrado_en)
     VALUES ($1, $2, 'AJUSTE', 1.5, $3, $4, $5, $6, $7)`,
    [input.tenantId, input.partidaId, input.motivo, input.observacion, input.registradoPorId, input.autorizadoPorId, input.registradoEn],
  );
}

/** A tenant with a vigente DT and one partida (INGRESO_COMPRA movement included) per droga. */
async function tenantConDt(tx: Client, suffix: string) {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, suffix);
  await designarDt(tx, tenantId, dt, sistema);
  const proveedorId = await insertProveedor(tx, tenantId);
  return { tenantId, sistema, dt, proveedorId };
}

/**
 * Alfa (lote L-ALFA-01): "a1" ROTURA   2026-06-10 12:00 Mendoza
 * Beta (lote L-BETA-77): "b1" VENCIMIENTO 2026-06-15 23:30 Mendoza (= 2026-06-16 02:30 UTC: jornada 06-15)
 * Alfa (lote L-ALFA-01): "a2" DERRAME  2026-06-20 09:00 Mendoza
 * Another tenant's AJUSTE and every INGRESO_COMPRA are never listed.
 */
async function seed(tx: Client): Promise<Escenario> {
  const { tenantId, sistema, dt, proveedorId } = await tenantConDt(tx, "ajlst");
  const g = await unidadId(tx, "GRAMO");
  const alfa = await insertDroga(tx, tenantId, "Alfa", g);
  const beta = await insertDroga(tx, tenantId, "Beta", g);
  const partidaAlfa = await crearPartidaConIngreso(tx, { tenantId, drogaId: alfa, proveedorId, registradoPorId: sistema, cantidadInicial: 100, fechaVencimiento: FUTURO, lote: "L-ALFA-01" });
  const partidaBeta = await crearPartidaConIngreso(tx, { tenantId, drogaId: beta, proveedorId, registradoPorId: sistema, cantidadInicial: 100, fechaVencimiento: FUTURO, lote: "L-BETA-77" });

  const base = { tenantId, registradoPorId: sistema, autorizadoPorId: dt };
  await insertAjuste(tx, { ...base, partidaId: partidaAlfa, motivo: "ROTURA", observacion: "a1", registradoEn: "2026-06-10T12:00:00-03:00" });
  await insertAjuste(tx, { ...base, partidaId: partidaBeta, motivo: "VENCIMIENTO", observacion: "b1", registradoEn: "2026-06-15T23:30:00-03:00" });
  await insertAjuste(tx, { ...base, partidaId: partidaAlfa, motivo: "DERRAME", observacion: "a2", registradoEn: "2026-06-20T09:00:00-03:00" });

  const otro = await tenantConDt(tx, "ajlst2");
  const otraDroga = await insertDroga(tx, otro.tenantId, "Alfa", g);
  const otraPartida = await crearPartidaConIngreso(tx, { tenantId: otro.tenantId, drogaId: otraDroga, proveedorId: otro.proveedorId, registradoPorId: otro.sistema, fechaVencimiento: FUTURO });
  await insertAjuste(tx, { tenantId: otro.tenantId, partidaId: otraPartida, motivo: "ROTURA", observacion: "otro-tenant", registradoEn: "2026-06-12T12:00:00-03:00", registradoPorId: otro.sistema, autorizadoPorId: otro.dt });

  return {
    tenantId,
    listar: async (filter = {}) => {
      const sql = listAjustesSql({ tenantId, page: 1, pageSize: 20, ...filter });
      const result = await tx.query(sql.text, sql.values);
      const rows = result.rows as ListAjustesRow[];
      return { rows, total: rows[0]?.total ?? 0, observaciones: rows.filter((r) => r.id !== null).map((r) => r.observacion!) };
    },
  };
}

function enEscenario(fn: (escenario: Escenario) => Promise<void>): Promise<void> {
  return asOwner((client) => inRollbackTx(client, async (tx) => fn(await seed(tx))));
}

describe.skipIf(dbTestSkipReason() !== null)("listAjustes: filters, order and pagination in SQL", () => {
  it("lists only this tenant's AJUSTE movements, newest first", async () => {
    await enEscenario(async ({ listar }) => {
      const { observaciones, total } = await listar();
      expect(observaciones).toEqual(["a2", "b1", "a1"]);
      expect(total).toBe(3);
    });
  });

  it("returns every display column, numerics as text", async () => {
    await enEscenario(async ({ listar }) => {
      const { rows } = await listar({ search: "beta" });
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toMatchObject({
        droga_nombre: "Beta",
        lote: "L-BETA-77",
        unidad_simbolo: "g",
        motivo_ajuste: "VENCIMIENTO",
        registrado_por_nombre: "Sistema",
        autorizado_por_nombre: "N",
        autorizado_por_apellido: "A",
        zona_horaria: "America/Argentina/Mendoza",
      });
      expect(typeof row.cantidad).toBe("string");
      expect(Number(row.cantidad)).toBe(1.5);
      expect(row.registrado_en).toBeInstanceOf(Date);
    });
  });

  it("searches droga name or lote, case-insensitively", async () => {
    await enEscenario(async ({ listar }) => {
      expect((await listar({ search: "ALF" })).observaciones).toEqual(["a2", "a1"]);
      expect((await listar({ search: "beta-77" })).observaciones).toEqual(["b1"]);
      expect((await listar({ search: "zzz" })).observaciones).toEqual([]);
    });
  });

  it("filters by motivo", async () => {
    await enEscenario(async ({ listar }) => {
      expect((await listar({ motivoAjuste: "ROTURA" })).observaciones).toEqual(["a1"]);
      expect((await listar({ motivoAjuste: "DIFERENCIA_ARQUEO" })).total).toBe(0);
    });
  });

  it("filters by the tenant's jornada (inclusive), not the UTC day", async () => {
    await enEscenario(async ({ listar }) => {
      // b1 is 2026-06-16 in UTC but jornada 2026-06-15 in Mendoza.
      expect((await listar({ desde: "2026-06-15", hasta: "2026-06-15" })).observaciones).toEqual(["b1"]);
      expect((await listar({ desde: "2026-06-16", hasta: "2026-06-19" })).observaciones).toEqual([]);
      expect((await listar({ desde: "2026-06-10" })).observaciones).toEqual(["a2", "b1", "a1"]);
      expect((await listar({ hasta: "2026-06-10" })).observaciones).toEqual(["a1"]);
    });
  });

  it("combines filters with AND", async () => {
    await enEscenario(async ({ listar }) => {
      expect((await listar({ search: "alfa", desde: "2026-06-15" })).observaciones).toEqual(["a2"]);
      expect((await listar({ search: "alfa", motivoAjuste: "VENCIMIENTO" })).observaciones).toEqual([]);
    });
  });

  it("paginates in SQL and still reports the total past the last page", async () => {
    await enEscenario(async ({ listar }) => {
      expect(await listar({ page: 2, pageSize: 2 })).toMatchObject({ observaciones: ["a1"], total: 3 });
      const vacia = await listar({ page: 3, pageSize: 2 });
      expect(vacia).toMatchObject({ observaciones: [], total: 3 });
      expect(vacia.rows[0]!.zona_horaria).toBe("America/Argentina/Mendoza");
    });
  });
});
