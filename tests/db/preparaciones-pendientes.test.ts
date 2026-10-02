/**
 * DB test for the /preparaciones "Pendientes" tab:
 * `modules/preparaciones/infrastructure/preparacion-repository.ts#listPendientesDePreparacionSql`
 * decides which receta ítems still need a preparación, and orders and
 * paginates them, entirely in SQL.
 *
 * Same approach as tests/db/stock-ajustes-listado.test.ts: it runs the
 * repository's OWN statement on the raw `pg` connection, since Prisma's
 * connection could not see the rows this test inserts inside its
 * never-committed transaction. Every test runs inside `inRollbackTx` --
 * nothing is ever committed.
 *
 * `fecha_ingreso` is set explicitly on each receta (every insert in one
 * transaction shares the same `now()`); the tenant uses the default zona
 * horaria (America/Argentina/Mendoza, UTC-3).
 *
 * Also `listComponentesDePendientesSql`, the "Ver" preview's batched read of
 * the page's componentes.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx } from "./helpers";
import {
  createSistemaUser,
  createUserWithRole,
  insertComponente,
  insertDroga,
  insertFicha,
  insertItemReceta,
  insertMedico,
  insertPaciente,
  insertReceta,
  insertTenant,
  insertUnidad,
} from "./fixtures";
import {
  listComponentesDePendientesSql,
  listPendientesDePreparacionSql,
  type ListComponentesDePendientesRow,
  type ListPendientesDePreparacionFilter,
  type ListPendientesDePreparacionRow,
} from "@/modules/preparaciones/infrastructure/preparacion-repository";

interface Escenario {
  ids: Record<string, string>;
  listar: (filter?: Partial<ListPendientesDePreparacionFilter>) => Promise<{ total: number; rows: ListPendientesDePreparacionRow[]; items: string[] }>;
  componentes: (itemIds: string[]) => Promise<ListComponentesDePendientesRow[]>;
}

async function insertPreparacion(tx: Client, tenantId: string, fichaTecnicaId: string, iniciadaPorId: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`, [
    tenantId,
    fichaTecnicaId,
    iniciadaPorId,
  ]);
  return result.rows[0].id as string;
}

/**
 * Recetas (fecha_ingreso, Mendoza):
 *   E  2026-08-31 09:00, EN_PREPARACION   e1 (ficha)
 *   A  2026-09-01 10:00                   a1 (fichas v1 + v2; 50 g, posología, 2 componentes), a2 (INICIADA -> taken), a3 (no ficha)
 *   C  2026-09-01 10:00 (after A: higher Nº) c1 (ficha)
 *   B  2026-09-02 08:00                   b1 (ficha, its preparación DESCARTADA -> back in the queue)
 *   D  2026-08-01 08:00, ANULADA           d1 (ficha) -- terminal, never listed
 * Another tenant's PENDIENTE_PREPARACION receta is never listed (its ítem has a componente too).
 */
async function seed(tx: Client): Promise<Escenario> {
  const tenantId = await insertTenant(tx, "prpend");
  const sistema = await createSistemaUser(tx, tenantId);
  const far = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "prpend");
  const medicoId = await insertMedico(tx, tenantId);
  const pacienteId = await insertPaciente(tx, tenantId);

  async function receta(fechaIngreso: string): Promise<string> {
    const id = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
    await tx.query(`UPDATE fsj.receta SET fecha_ingreso = $1 WHERE id = $2`, [fechaIngreso, id]);
    return id;
  }
  const item = (recetaId: string) => insertItemReceta(tx, { tenantId, recetaId });
  const ficha = (itemRecetaId: string, version = 1) => insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema, version });

  const unidad = await insertUnidad(tx, "prpend");
  const droga = await insertDroga(tx, tenantId, unidad);
  const excipiente = await insertDroga(tx, tenantId, unidad);

  const recetaA = await receta("2026-09-01T10:00:00-03:00");
  const a1 = await insertItemReceta(tx, { tenantId, recetaId: recetaA, cantidadTotal: 50, unidadTotalId: unidad });
  await tx.query(`UPDATE fsj.item_receta SET posologia = 'Cada 12 h', duracion_tratamiento_dias = 10 WHERE id = $1`, [a1]);
  // Inserted out of `orden` on purpose: the read returns them in `orden`.
  const a1Excipiente = await insertComponente(tx, { tenantId, itemRecetaId: a1, drogaId: excipiente, unidadMedidaId: unidad, modoExpresion: "CSP", orden: 1 });
  const a1Activo = await insertComponente(tx, { tenantId, itemRecetaId: a1, drogaId: droga, unidadMedidaId: unidad, modoExpresion: "TOTAL", cantidad: 2.5, orden: 0 });
  await tx.query(`UPDATE fsj.componente_item_receta SET es_principio_activo = true WHERE id = $1`, [a1Activo]);
  const a2 = await item(recetaA);
  const a3 = await item(recetaA);
  await ficha(a1, 1);
  const a1v2 = await ficha(a1, 2);
  const a2f = await ficha(a2);
  await insertPreparacion(tx, tenantId, a2f, far);

  const recetaB = await receta("2026-09-02T08:00:00-03:00");
  const b1 = await item(recetaB);
  const b1f = await ficha(b1);
  const descartada = await insertPreparacion(tx, tenantId, b1f, far);
  await tx.query(`UPDATE fsj.preparacion SET estado = 'DESCARTADA', motivo_descarte = 'Test', descartada_por_id = $1, descartada_en = now() WHERE id = $2`, [
    far,
    descartada,
  ]);

  const recetaC = await receta("2026-09-01T10:00:00-03:00");
  const c1 = await item(recetaC);
  const c1f = await ficha(c1);

  const recetaD = await receta("2026-08-01T08:00:00-03:00");
  const d1 = await item(recetaD);
  await ficha(d1);
  await tx.query(`UPDATE fsj.receta SET estado = 'ANULADA', motivo_anulacion = 'Test' WHERE id = $1`, [recetaD]);

  const recetaE = await receta("2026-08-31T09:00:00-03:00");
  const e1 = await item(recetaE);
  const e1f = await ficha(e1);
  await tx.query(`UPDATE fsj.receta SET estado = 'EN_PREPARACION' WHERE id = $1`, [recetaE]);

  const otroTenant = await insertTenant(tx, "prpend2");
  const otroSistema = await createSistemaUser(tx, otroTenant);
  const otraReceta = await insertReceta(tx, {
    tenantId: otroTenant,
    pacienteId: await insertPaciente(tx, otroTenant),
    medicoId: await insertMedico(tx, otroTenant),
    registradaPorId: otroSistema,
  });
  const otroItem = await insertItemReceta(tx, { tenantId: otroTenant, recetaId: otraReceta });
  const otraUnidad = await insertUnidad(tx, "prpend2");
  await insertComponente(tx, { tenantId: otroTenant, itemRecetaId: otroItem, drogaId: await insertDroga(tx, otroTenant, otraUnidad), unidadMedidaId: otraUnidad });

  const numeros = await tx.query(`SELECT id, numero_interno::text AS numero FROM fsj.receta WHERE id = ANY($1::uuid[])`, [[recetaA, recetaC]]);
  const numero = (id: string) => numeros.rows.find((r: { id: string }) => r.id === id).numero as string;

  const ids = {
    recetaA,
    recetaB,
    recetaC,
    recetaE,
    a1,
    a2,
    a3,
    b1,
    c1,
    d1,
    e1,
    a1v2,
    b1f,
    c1f,
    e1f,
    a1Activo,
    a1Excipiente,
    otroItem,
    numeroA: numero(recetaA),
    numeroC: numero(recetaC),
  };
  const nombres = new Map<string, string>([
    [a1, "a1"],
    [a2, "a2"],
    [a3, "a3"],
    [b1, "b1"],
    [c1, "c1"],
    [d1, "d1"],
    [e1, "e1"],
  ]);

  return {
    ids,
    listar: async (filter = {}) => {
      const sql = listPendientesDePreparacionSql({ tenantId, page: 1, pageSize: 20, ...filter });
      const result = await tx.query(sql.text, sql.values);
      const rows = result.rows as ListPendientesDePreparacionRow[];
      return {
        rows,
        total: rows[0]?.total ?? 0,
        items: rows.filter((r) => r.item_receta_id !== null).map((r) => nombres.get(r.item_receta_id!) ?? `?${r.item_receta_id}`),
      };
    },
    componentes: async (itemIds) => {
      const sql = listComponentesDePendientesSql(tenantId, itemIds);
      return (await tx.query(sql.text, sql.values)).rows as ListComponentesDePendientesRow[];
    },
  };
}

function enEscenario(fn: (escenario: Escenario) => Promise<void>): Promise<void> {
  return asOwner((client) => inRollbackTx(client, async (tx) => fn(await seed(tx))));
}

describe.skipIf(dbTestSkipReason() !== null)("listPendientesDePreparacion: the lab's queue, in SQL", () => {
  it("lists every ítem still needing a preparación, oldest first (ingreso, receta Nº, ítem position)", async () => {
    await enEscenario(async ({ listar }) => {
      const { items, total } = await listar();
      // a2 has an INICIADA preparación; d1's receta is ANULADA; the other tenant's ítem is not ours.
      expect(items).toEqual(["e1", "a1", "a3", "c1", "b1"]);
      expect(total).toBe(5);
    });
  });

  it("an ítem with a DESCARTADA preparación is back in the queue; an EN_PREPARACION receta's free ítems are listed", async () => {
    await enEscenario(async ({ listar, ids }) => {
      const { rows } = await listar();
      expect(rows.find((r) => r.item_receta_id === ids.b1)?.ficha_tecnica_id).toBe(ids.b1f);
      expect(rows.find((r) => r.item_receta_id === ids.e1)?.ficha_tecnica_id).toBe(ids.e1f);
    });
  });

  it("hands the LATEST ficha version, or NULL when the ítem has none", async () => {
    await enEscenario(async ({ listar, ids }) => {
      const { rows } = await listar();
      expect(rows.find((r) => r.item_receta_id === ids.a1)?.ficha_tecnica_id).toBe(ids.a1v2);
      expect(rows.find((r) => r.item_receta_id === ids.a3)?.ficha_tecnica_id).toBeNull();
    });
  });

  it("counts the ítem's position over ALL the receta's ítems, taken ones included", async () => {
    await enEscenario(async ({ listar, ids }) => {
      const { rows } = await listar();
      const a1 = rows.find((r) => r.item_receta_id === ids.a1)!;
      const a3 = rows.find((r) => r.item_receta_id === ids.a3)!;
      expect([a1.posicion, a1.total_items]).toEqual([1, 3]);
      expect([a3.posicion, a3.total_items]).toEqual([3, 3]);
      expect(a1).toMatchObject({ receta_id: ids.recetaA, receta_numero_interno: ids.numeroA, forma_farmaceutica: "CREMA", paciente_nombre: "Pac", paciente_apellido: "Iente" });
      expect(a1.receta_fecha_ingreso).toBeInstanceOf(Date);
      expect(rows.find((r) => r.item_receta_id === ids.c1)).toMatchObject({ posicion: 1, total_items: 1 });
    });
  });

  it("filters by receta Nº and by the ingreso jornada (tenant's calendar day, inclusive)", async () => {
    await enEscenario(async ({ listar, ids }) => {
      expect((await listar({ numeroInterno: ids.numeroC })).items).toEqual(["c1"]);
      expect((await listar({ desde: "2026-09-01", hasta: "2026-09-01" })).items).toEqual(["a1", "a3", "c1"]);
      expect((await listar({ desde: "2026-09-02" })).items).toEqual(["b1"]);
      expect((await listar({ hasta: "2026-08-31" })).items).toEqual(["e1"]);
    });
  });

  it("paginates in SQL and still reports the total past the last page", async () => {
    await enEscenario(async ({ listar }) => {
      expect((await listar({ page: 2, pageSize: 2 })).items).toEqual(["a3", "c1"]);
      const pasado = await listar({ page: 9, pageSize: 2 });
      expect(pasado.items).toEqual([]);
      expect(pasado.total).toBe(5);
      expect(pasado.rows[0]?.zona_horaria).toBe("America/Argentina/Mendoza");
    });
  });

  it("carries what has to be prepared: the ítem's cantidades and posología", async () => {
    await enEscenario(async ({ listar, ids }) => {
      const { rows } = await listar();
      expect(rows.find((r) => r.item_receta_id === ids.a1)).toMatchObject({
        cantidad_unidades: 1,
        cantidad_total: "50",
        unidad_total_simbolo: "x",
        posologia: "Cada 12 h",
        duracion_tratamiento_dias: 10,
      });
      expect(rows.find((r) => r.item_receta_id === ids.a3)).toMatchObject({ cantidad_total: null, unidad_total_simbolo: null, posologia: null, duracion_tratamiento_dias: null });
    });
  });

  it("reads the page's componentes in one statement, in orden, only the tenant's", async () => {
    await enEscenario(async ({ componentes, ids }) => {
      const rows = await componentes([ids.a1, ids.a3, ids.otroItem]);
      expect(rows.map((r) => r.id)).toEqual([ids.a1Activo, ids.a1Excipiente]);
      expect(rows[0]).toMatchObject({ item_receta_id: ids.a1, cantidad: "2.5", unidad_medida_simbolo: "x", modo_expresion: "TOTAL", es_principio_activo: true });
      expect(rows[0]!.droga_nombre).toMatch(/^Droga-/);
      expect(rows[1]).toMatchObject({ cantidad: null, modo_expresion: "CSP", es_principio_activo: false });
    });
  });
});
