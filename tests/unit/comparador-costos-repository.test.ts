/**
 * `getComparacionCruda` & co. (modules/proveedores/infrastructure/comparador-costos-repository.ts)
 * against a recording fake `tx`: proves the read pattern -- a constant number
 * of statements (no N+1), every query scoped by tenantId, EXPLICIT selects
 * everywhere (schema.prisma still declares receta columns the shared DB
 * dropped, and this view must never reach receta/paciente), numeric handled as
 * text in SQL, cost-0 partidas excluded from the metrics, the detail bounded
 * with LATERAL ... LIMIT, and the outlier band decided by the domain. No DB.
 *
 * The fake `tx` throws on any delegate the repository is not expected to
 * touch (so a stray `tx.receta` / `tx.partida` / `include` cannot slip in).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { PARTIDAS_DETALLE_MAX } from "@/modules/proveedores/domain/comparador-costos";
import { getComparacionCruda, readDrogasConPartidas } from "@/modules/proveedores/infrastructure/comparador-costos-repository";

const TENANT = "11111111-1111-4111-8111-111111111111";
const DROGA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROV_A = "22222222-2222-4222-a222-222222222222";
const PROV_B = "33333333-3333-4333-a333-333333333333";

interface FakeOpts {
  droga?: boolean;
  mediana?: string | null;
  partidasConCosto?: number;
  agregados?: { proveedor_id: string }[];
}

function fakeTx(opts: FakeOpts = {}) {
  const { droga = true, mediana = "0.01", partidasConCosto = 5 } = opts;
  const agregados = opts.agregados ?? [{ proveedor_id: PROV_A }, { proveedor_id: PROV_B }];
  const decimal = (s: string) => ({ toString: () => s });

  const base = {
    droga: {
      findMany: vi.fn(async () => [
        { id: DROGA, nombre: "Minoxidil", fechaBaja: null },
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nombre: "Zinc", fechaBaja: new Date("2026-01-01T00:00:00Z") },
      ]),
      findFirst: vi.fn(async () =>
        droga
          ? {
              id: DROGA,
              nombre: "Minoxidil",
              fechaBaja: null,
              unidadBase: { id: "u-mg", codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factorABase: decimal("0.0010000000"), esBase: false, fechaBaja: null },
            }
          : null,
      ),
    },
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
    unidadMedida: {
      findMany: vi.fn(async () => [
        { id: "u-mg", codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factorABase: decimal("0.0010000000"), esBase: false, fechaBaja: null },
        { id: "u-g", codigo: "GRAMO", simbolo: "g", tipoMagnitud: "MASA", factorABase: decimal("1.0000000000"), esBase: true, fechaBaja: null },
        { id: "u-kg", codigo: "KILOGRAMO", simbolo: "kg", tipoMagnitud: "MASA", factorABase: decimal("1000.0000000000"), esBase: false, fechaBaja: new Date("2026-01-01T00:00:00Z") },
      ]),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("AS jornada")) return [{ jornada: "2026-10-01" }];
      if (sql.includes("AS mediana")) return [{ partidas_con_costo: partidasConCosto, mediana }];
      if (sql.includes("WITH base AS")) {
        return agregados.map((a, i) => ({
          proveedor_id: a.proveedor_id,
          razon_social: `Proveedor ${i}`,
          fecha_baja: null,
          partidas_total: 3,
          partidas_con_costo: 2,
          partidas_costo_cero: 1,
          partidas_atipicas: 0,
          cantidad_con_costo: "3000",
          importe_con_costo: "30.5",
          costo_min: "0.009",
          costo_max: "0.011",
          ultimo_costo: "0.01",
          ultima_compra: new Date("2026-09-15T12:00:00Z"),
        }));
      }
      if (sql.includes("CROSS JOIN LATERAL")) {
        return [{ id: "p1", proveedor_id: PROV_A, lote: "L1", fecha_ingreso: new Date("2026-09-15T12:00:00Z"), cantidad_inicial: "1500", costo_unitario: "0.01" }];
      }
      throw new Error(`unexpected raw query: ${sql}`);
    }),
  };

  // Any model the repository is not supposed to touch (receta, paciente, partida, ...) throws on access.
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target || typeof prop === "symbol" || prop === "then") return (target as Record<string | symbol, unknown>)[prop];
      throw new Error(`unexpected tx.${prop} access`);
    },
  }) as typeof base;
}

type FakeTx = ReturnType<typeof fakeTx>;
const asTx = (tx: FakeTx) => tx as unknown as Prisma.TransactionClient;
const rawCalls = (tx: FakeTx) => tx.$queryRaw.mock.calls as unknown as [TemplateStringsArray, ...unknown[]][];
const rawSql = (tx: FakeTx) => rawCalls(tx).map((c) => c[0].join("?"));
const sqlOf = (tx: FakeTx, needle: string) => rawSql(tx).find((s) => s.includes(needle))!;
const valuesOf = (tx: FakeTx, needle: string) => rawCalls(tx)[rawSql(tx).findIndex((s) => s.includes(needle))]!.slice(1);

describe("readDrogasConPartidas", () => {
  it("lists the tenant's drogas that have at least one partida, with an explicit select and no relation loaded", async () => {
    const tx = fakeTx();
    const r = await readDrogasConPartidas(asTx(tx), TENANT);
    const arg = (tx.droga.findMany.mock.calls[0] as unknown as [{ where: unknown; select: unknown; include?: unknown; orderBy: unknown }])[0];
    expect(arg.where).toEqual({ tenantId: TENANT, partidas: { some: { tenantId: TENANT } } });
    expect(arg.select).toEqual({ id: true, nombre: true, fechaBaja: true });
    expect(arg.include).toBeUndefined();
    expect(arg.orderBy).toEqual([{ nombre: "asc" }, { id: "asc" }]);
    expect(r).toHaveLength(2);
  });
});

describe("getComparacionCruda", () => {
  it("returns null -- and reads nothing else -- when the droga is not one of the tenant's drogas with partidas", async () => {
    const tx = fakeTx({ droga: false });
    expect(await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m")).toBeNull();
    expect(tx.droga.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: DROGA, tenantId: TENANT, partidas: { some: { tenantId: TENANT } } } }));
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.unidadMedida.findMany).not.toHaveBeenCalled();
  });

  it("uses a constant number of statements (jornada, median, aggregates, detail), whatever the number of proveedores", async () => {
    const pocos = fakeTx({ agregados: [{ proveedor_id: PROV_A }] });
    await getComparacionCruda(asTx(pocos), TENANT, DROGA, "12m");
    const muchos = fakeTx({ agregados: Array.from({ length: 40 }, (_, i) => ({ proveedor_id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000` })) });
    await getComparacionCruda(asTx(muchos), TENANT, DROGA, "12m");
    expect(pocos.$queryRaw).toHaveBeenCalledTimes(4);
    expect(muchos.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it("explicit select on EVERY Prisma call: no bare find, no include", async () => {
    const tx = fakeTx();
    await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m");
    for (const fn of [tx.droga.findFirst, tx.tenant.findUniqueOrThrow, tx.unidadMedida.findMany]) {
      const arg = (fn.mock.calls[0] as unknown as [{ select?: unknown; include?: unknown }])[0];
      expect(arg.select).toBeDefined();
      expect(arg.include).toBeUndefined();
    }
    const select = (tx.droga.findFirst.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0].select;
    expect(Object.keys(select).sort()).toEqual(["fechaBaja", "id", "nombre", "unidadBase"]);
    expect((select.unidadBase as { select: Record<string, unknown> }).select).toEqual({
      id: true,
      codigo: true,
      simbolo: true,
      tipoMagnitud: true,
      factorABase: true,
      esBase: true,
      fechaBaja: true,
    });
  });

  it("only touches the droga, tenant and unidad_medida delegates: never receta, paciente or the partida model (the fake throws otherwise)", async () => {
    const tx = fakeTx();
    await expect(getComparacionCruda(asTx(tx), TENANT, DROGA, "todo")).resolves.not.toBeNull();
    for (const sql of rawSql(tx)) expect(sql).not.toMatch(/receta|paciente|cotizacion|entrega|item_receta/i);
  });

  it("scopes the droga, the unit catalog read and every raw statement by the bound tenant id", async () => {
    const tx = fakeTx();
    await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m");
    expect(tx.tenant.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TENANT } }));
    // the unit catalog is GLOBAL (no tenant_id column): filtered by magnitud only
    expect(tx.unidadMedida.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tipoMagnitud: "MASA" } }));
    rawCalls(tx).forEach((call, i) => {
      expect(call[0].join("?"), `statement #${i}`).toMatch(/p\.tenant_id = \?::uuid|jornada_actual\(\?::uuid\)/);
      expect(call.slice(1), `statement #${i}`).toContain(TENANT);
    });
  });

  it("filters by droga and tenant on every partida read (base CTE, median, detail)", async () => {
    const tx = fakeTx();
    await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m");
    for (const needle of ["AS mediana", "WITH base AS", "CROSS JOIN LATERAL"]) {
      expect(sqlOf(tx, needle), needle).toContain("p.tenant_id = ?::uuid");
      expect(sqlOf(tx, needle), needle).toContain("p.droga_id = ?::uuid");
      expect(valuesOf(tx, needle), needle).toEqual(expect.arrayContaining([TENANT, DROGA]));
    }
    // the proveedor join is tenant-scoped too
    expect(sqlOf(tx, "WITH base AS")).toContain("pr.tenant_id = ?::uuid AND pr.id = a.proveedor_id");
  });

  it("numeric stays numeric in SQL and crosses as text: median, sums, min/max, último costo, quantities", async () => {
    const tx = fakeTx();
    const r = await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m");
    expect(sqlOf(tx, "AS mediana")).toContain("percentile_disc(0.5) WITHIN GROUP (ORDER BY p.costo_unitario)");
    expect(sqlOf(tx, "AS mediana")).toContain("::text AS mediana");
    const agg = sqlOf(tx, "WITH base AS");
    expect(agg).toContain("sum(b.cantidad_inicial * b.costo_unitario)");
    expect(agg).toContain("::text AS importe_con_costo");
    expect(agg).toContain("::text AS cantidad_con_costo");
    expect(agg).toContain("::text AS costo_min");
    expect(agg).toContain("::text AS costo_max");
    expect(agg).toContain("b.costo_unitario::text AS ultimo_costo");
    expect(agg).not.toMatch(/::float|::double|::real/i);
    const detalle = sqlOf(tx, "CROSS JOIN LATERAL");
    expect(detalle).toContain("p.cantidad_inicial::text AS cantidad_inicial");
    expect(detalle).toContain("p.costo_unitario::text AS costo_unitario");
    expect(r!.agregados[0]).toMatchObject({ importeConCosto: "30.5", cantidadConCosto: "3000", ultimoCosto: "0.01", costoMin: "0.009", costoMax: "0.011" });
    expect(typeof r!.partidas[0]!.costoUnitario).toBe("string");
  });

  it("the latest cost is a DISTINCT ON over the costed partidas, newest first with an id tie-break", async () => {
    const tx = fakeTx();
    await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m");
    const agg = sqlOf(tx, "WITH base AS");
    expect(agg).toContain("SELECT DISTINCT ON (b.proveedor_id)");
    expect(agg).toContain("WHERE b.costo_unitario > 0");
    expect(agg).toContain("ORDER BY b.proveedor_id, b.fecha_ingreso DESC, b.id DESC");
  });

  it("cost-0 partidas are counted but excluded from every metric (FILTER costo > 0)", async () => {
    const tx = fakeTx();
    await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m");
    const agg = sqlOf(tx, "WITH base AS");
    expect(agg).toContain("count(*) FILTER (WHERE b.costo_unitario = 0)");
    for (const metric of ["sum(b.cantidad_inicial)", "sum(b.cantidad_inicial * b.costo_unitario)", "min(b.costo_unitario)", "max(b.costo_unitario)"]) {
      expect(agg, metric).toContain(`${metric} FILTER (WHERE b.costo_unitario > 0)`);
    }
    expect(sqlOf(tx, "AS mediana")).toContain("p.costo_unitario > 0");
  });

  it("reads the detail of ALL the proveedores in ONE statement: unnest + LATERAL ... LIMIT 50, newest first", async () => {
    const tx = fakeTx();
    await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m");
    expect(rawSql(tx).filter((s) => s.includes("CROSS JOIN LATERAL"))).toHaveLength(1);
    const sql = sqlOf(tx, "CROSS JOIN LATERAL");
    expect(sql).toContain("unnest(?::uuid[]) AS pv(id)");
    expect(sql).toContain("p.proveedor_id = pv.id");
    expect(sql).toContain("ORDER BY p.fecha_ingreso DESC, p.id DESC");
    expect(sql).toContain("LIMIT ?::int");
    expect(sql).not.toMatch(/ROW_NUMBER|COUNT\(\*\) OVER/);
    const values = valuesOf(tx, "CROSS JOIN LATERAL");
    expect(values).toContainEqual([PROV_A, PROV_B]);
    expect(values).toContain(PARTIDAS_DETALLE_MAX);
  });

  it("skips the detail statement when no proveedor has partidas in the period", async () => {
    const tx = fakeTx({ agregados: [], partidasConCosto: 0, mediana: null });
    const r = await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m");
    expect(rawSql(tx).some((s) => s.includes("CROSS JOIN LATERAL"))).toBe(false);
    expect(r).toMatchObject({ agregados: [], partidas: [], limites: null });
  });

  it("the period: 12m starts at local midnight (tenant zone) a year before the tenant's jornada; `todo` binds no start", async () => {
    const doce = fakeTx();
    const r12 = await getComparacionCruda(asTx(doce), TENANT, DROGA, "12m");
    const inicio = new Date("2025-10-01T03:00:00.000Z");
    expect(r12!.inicio).toEqual(inicio);
    for (const needle of ["AS mediana", "WITH base AS", "CROSS JOIN LATERAL"]) {
      expect(sqlOf(doce, needle)).toContain("p.fecha_ingreso >= ?::timestamptz");
      expect(valuesOf(doce, needle)).toContainEqual(inicio);
    }

    const todo = fakeTx();
    const rTodo = await getComparacionCruda(asTx(todo), TENANT, DROGA, "todo");
    expect(rTodo!.inicio).toBeNull();
    expect(valuesOf(todo, "WITH base AS")).not.toContainEqual(expect.any(Date));
    expect(rTodo).toMatchObject({ jornada: "2026-10-01", zonaHoraria: "America/Argentina/Mendoza", periodo: "todo" });
  });

  it("the outlier band comes from the DOMAIN (median x 0.1 / x 10, >= 3 partidas) and is bound into the aggregate", async () => {
    const con = fakeTx({ mediana: "10", partidasConCosto: 5 });
    const r = await getComparacionCruda(asTx(con), TENANT, DROGA, "12m");
    expect(r!.limites).toEqual({ minimo: "1", maximo: "100" });
    expect(sqlOf(con, "WITH base AS")).toContain("b.costo_unitario > ?::numeric");
    expect(sqlOf(con, "WITH base AS")).toContain("b.costo_unitario < ?::numeric");
    expect(valuesOf(con, "WITH base AS")).toEqual(expect.arrayContaining(["1", "100"]));

    const sin = fakeTx({ mediana: "10", partidasConCosto: 2 });
    const rSin = await getComparacionCruda(asTx(sin), TENANT, DROGA, "12m");
    expect(rSin!.limites).toBeNull();
    expect(valuesOf(sin, "WITH base AS")).not.toContain("100");
    expect(valuesOf(sin, "WITH base AS")).toContain(null);
  });

  it("maps the droga, its unidad base and the unit catalog of the magnitude (factors as text, baja flagged)", async () => {
    const tx = fakeTx();
    const r = await getComparacionCruda(asTx(tx), TENANT, DROGA, "12m");
    expect(r!.droga).toEqual({ id: DROGA, nombre: "Minoxidil", deBaja: false });
    expect(r!.unidadBase).toEqual({ id: "u-mg", codigo: "MILIGRAMO", simbolo: "mg", tipoMagnitud: "MASA", factorABase: "0.0010000000", esBase: false, vigente: true });
    expect(r!.unidadesCatalogo.map((u) => [u.codigo, u.factorABase, u.vigente])).toEqual([
      ["MILIGRAMO", "0.0010000000", true],
      ["GRAMO", "1.0000000000", true],
      ["KILOGRAMO", "1000.0000000000", false],
    ]);
    expect(r!.partidasConCosto).toBe(5);
  });
});

describe("repository source", () => {
  it("never queries the receta / paciente tables and never selects with a wildcard", () => {
    const source = readFileSync(path.join(process.cwd(), "modules/proveedores/infrastructure/comparador-costos-repository.ts"), "utf8");
    // Strip comments: the header explains what is NOT read.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\breceta\b|\bpaciente\b|item_receta|\.receta\b/i);
    expect(code).not.toMatch(/SELECT \*|\.\*|\binclude:/);
  });
});
