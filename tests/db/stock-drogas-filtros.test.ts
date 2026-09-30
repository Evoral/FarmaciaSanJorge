/**
 * DB test for `/stock`'s listing (M07, FASE 5 point 5.2):
 * `modules/stock/infrastructure/partida-repository.ts#listStockDrogas`
 * filters, orders and paginates entirely in SQL.
 *
 * Unlike most tests/db files, this does NOT reimplement the query: it runs
 * the repository's OWN statement (`listStockDrogasSql`, a `Prisma.sql`
 * value whose `.text`/`.values` are plain Postgres parameters) on the raw
 * `pg` connection, since Prisma's own connection could not see the rows
 * this test inserts inside its never-committed transaction (see
 * tests/db/auditoria-listado-cursor.test.ts's module doc comment). Every
 * test runs inside `inRollbackTx` -- nothing is ever committed.
 *
 * Dates are pinned with `setRelojPrueba` (jornada 2026-06-15), so "por
 * vencer" / "vencidas" never depend on the day the suite runs.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, setRelojPrueba } from "./helpers";
import { insertTenant, createSistemaUser, insertProveedor, crearPartidaConIngreso, FUTURO } from "./fixtures";
import { listStockDrogasSql, type ListStockDrogasFilter, type ListStockDrogasRow } from "@/modules/stock/infrastructure/partida-repository";

const JORNADA = "2026-06-15T12:00:00-03:00";
const DIAS_ALERTA = 30;

interface Escenario {
  tenantId: string;
  listar: (filter?: Partial<ListStockDrogasFilter>) => Promise<{ nombres: string[]; total: number; rows: ListStockDrogasRow[] }>;
}

async function unidadId(tx: Client, codigo: string): Promise<string> {
  const result = await tx.query(`SELECT id FROM fsj.unidad_medida WHERE codigo = $1`, [codigo]);
  return result.rows[0].id as string;
}

async function insertDroga(
  tx: Client,
  tenantId: string,
  nombre: string,
  unidad: string,
  opts: { stockMinimo?: number; tipoControl?: "PSICOTROPICO"; baja?: boolean } = {},
): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, stock_minimo, es_controlada, tipo_control, fecha_baja, motivo_baja)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      tenantId,
      nombre,
      unidad,
      opts.stockMinimo ?? 0,
      opts.tipoControl !== undefined,
      opts.tipoControl ?? "NINGUNO",
      opts.baja ? new Date() : null,
      opts.baja ? "Test" : null,
    ],
  );
  return result.rows[0].id as string;
}

/**
 * Alfa (mg): 500 mg in stock, mínimo 1000 mg        -> bajo mínimo; 0,5 g in base.
 * Beta (g): 2 g expiring 2026-06-20                -> por vencer; 2 g in base.
 * Gamma (kg): only an EXPIRED partida with balance -> sin stock + vencidas con saldo.
 * Delta (u): controlada, no partidas               -> sin stock + controlada (UNIDADES).
 * Epsilon (mg): dada de baja                       -> never listed.
 */
async function seed(tx: Client): Promise<Escenario> {
  const tenantId = await insertTenant(tx, "stkflt");
  const sistema = await createSistemaUser(tx, tenantId);
  const proveedorId = await insertProveedor(tx, tenantId);
  // One query at a time: a pg Client does not multiplex.
  const mg = await unidadId(tx, "MILIGRAMO");
  const g = await unidadId(tx, "GRAMO");
  const kg = await unidadId(tx, "KILOGRAMO");
  const u = await unidadId(tx, "UNIDAD");

  const alfa = await insertDroga(tx, tenantId, "Alfa", mg, { stockMinimo: 1000 });
  const beta = await insertDroga(tx, tenantId, "Beta", g);
  const gamma = await insertDroga(tx, tenantId, "Gamma", kg);
  await insertDroga(tx, tenantId, "Delta", u, { tipoControl: "PSICOTROPICO" });
  await insertDroga(tx, tenantId, "Epsilon", mg, { baja: true });

  // Gamma's partida is ingresada BEFORE it expires, then the clock moves past its vencimiento.
  await setRelojPrueba(tx, "2026-01-10T12:00:00-03:00");
  await crearPartidaConIngreso(tx, { tenantId, drogaId: gamma, proveedorId, registradoPorId: sistema, cantidadInicial: 1, fechaVencimiento: "2026-03-01" });
  await setRelojPrueba(tx, JORNADA);

  await crearPartidaConIngreso(tx, { tenantId, drogaId: alfa, proveedorId, registradoPorId: sistema, cantidadInicial: 500, fechaVencimiento: FUTURO });
  await crearPartidaConIngreso(tx, { tenantId, drogaId: beta, proveedorId, registradoPorId: sistema, cantidadInicial: 2, fechaVencimiento: "2026-06-20" });

  return {
    tenantId,
    listar: async (filter = {}) => {
      const sql = listStockDrogasSql({ tenantId, diasAlertaVencimiento: DIAS_ALERTA, page: 1, pageSize: 20, ...filter });
      const result = await tx.query(sql.text, sql.values);
      const rows = result.rows as ListStockDrogasRow[];
      return { rows, total: rows[0]?.total ?? 0, nombres: rows.filter((r) => r.droga_id !== null).map((r) => r.nombre!) };
    },
  };
}

function enEscenario(fn: (escenario: Escenario) => Promise<void>): Promise<void> {
  return asOwner((client) => inRollbackTx(client, async (tx) => fn(await seed(tx))));
}

describe.skipIf(dbTestSkipReason() !== null)("listStockDrogas: filters, order and pagination in SQL", () => {
  it("lists every vigente droga by name, never a dada de baja", async () => {
    await enEscenario(async ({ listar }) => {
      const { nombres, total } = await listar();
      expect(nombres).toEqual(["Alfa", "Beta", "Delta", "Gamma"]);
      expect(total).toBe(4);
    });
  });

  it("applies each boolean filter", async () => {
    await enEscenario(async ({ listar }) => {
      expect((await listar({ soloBajoMinimo: true })).nombres).toEqual(["Alfa"]);
      expect((await listar({ soloSinStock: true })).nombres).toEqual(["Delta", "Gamma"]);
      expect((await listar({ conPartidasPorVencer: true })).nombres).toEqual(["Beta"]);
      expect((await listar({ conPartidasVencidas: true })).nombres).toEqual(["Gamma"]);
      expect((await listar({ soloControladas: true })).nombres).toEqual(["Delta"]);
    });
  });

  it("combines filters with AND, including search", async () => {
    await enEscenario(async ({ listar }) => {
      expect((await listar({ soloSinStock: true, conPartidasVencidas: true })).nombres).toEqual(["Gamma"]);
      expect((await listar({ soloSinStock: true, soloControladas: true })).nombres).toEqual(["Delta"]);
      expect((await listar({ soloBajoMinimo: true, conPartidasPorVencer: true })).nombres).toEqual([]);
      expect((await listar({ search: "BET" })).nombres).toEqual(["Beta"]);
    });
  });

  it("excludes the window edges exactly like the alerts: por vencer ends at jornada + dias", async () => {
    await enEscenario(async ({ listar }) => {
      expect((await listar({ conPartidasPorVencer: true, diasAlertaVencimiento: 4 })).nombres).toEqual([]);
      expect((await listar({ conPartidasPorVencer: true, diasAlertaVencimiento: 5 })).nombres).toEqual(["Beta"]);
    });
  });

  it("orders by stock in each magnitude's base unit (500 mg < 2 g), ties by name", async () => {
    await enEscenario(async ({ listar }) => {
      expect((await listar({ orden: "stock" })).nombres).toEqual(["Delta", "Gamma", "Alfa", "Beta"]);
    });
  });

  it("orders by the earliest vencimiento among partidas with balance, NULLS LAST", async () => {
    await enEscenario(async ({ listar }) => {
      const { rows, nombres } = await listar({ orden: "vencimiento" });
      expect(nombres).toEqual(["Gamma", "Beta", "Alfa", "Delta"]);
      expect(rows.map((r) => r.proximo_vencimiento)).toEqual(["2026-03-01", "2026-06-20", FUTURO, null]);
    });
  });

  it("paginates in SQL and still reports the total past the last page", async () => {
    await enEscenario(async ({ listar }) => {
      expect(await listar({ page: 2, pageSize: 2 })).toMatchObject({ nombres: ["Delta", "Gamma"], total: 4 });
      expect(await listar({ page: 3, pageSize: 2 })).toMatchObject({ nombres: [], total: 4 });
    });
  });

  it("compares stock against stock_minimo in SQL and returns numerics as text", async () => {
    await enEscenario(async ({ listar }) => {
      const { rows } = await listar();
      const alfa = rows.find((r) => r.nombre === "Alfa")!;
      const beta = rows.find((r) => r.nombre === "Beta")!;
      expect(alfa.bajo_minimo).toBe(true);
      expect(beta.bajo_minimo).toBe(false);
      expect(typeof alfa.stock_disponible).toBe("string");
      expect(Number(alfa.stock_disponible)).toBe(500);
    });
  });
});
