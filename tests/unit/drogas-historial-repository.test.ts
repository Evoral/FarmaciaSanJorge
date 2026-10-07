/**
 * `getHistorialDrogaCruda` (modules/drogas/infrastructure/historial-repository.ts)
 * against a recording fake `tx`: proves the read pattern (batched, no N+1),
 * tenant scoping of EVERY join, explicit columns, the paciente statement only
 * when the caller says the session may see it, and that the partida filter is
 * never trusted. No DB.
 */
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { getHistorialDrogaCruda } from "@/modules/drogas/infrastructure/historial-repository";

const TENANT = "11111111-1111-4111-8111-111111111111";
const DROGA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARTIDA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARTIDA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PARTIDA_AJENA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const OPCIONES = [
  { id: PARTIDA_A, lote: "L-1", fecha_vencimiento: new Date("2027-01-31T00:00:00Z"), proveedor: "Droguería Sur" },
  { id: PARTIDA_B, lote: "L-2", fecha_vencimiento: null, proveedor: "Química Norte" },
];

interface FakeOpts {
  droga?: boolean;
  opciones?: typeof OPCIONES;
  totalRecetas?: number;
  /** What the count statement answers for the filtered total (defaults to `totalRecetas`). */
  totalFiltradas?: number;
  /** Receta rows the page statement answers. */
  recetas?: number;
}

function fakeTx(opts: FakeOpts = {}) {
  const { droga = true, opciones = OPCIONES, totalRecetas = 45, recetas = 2 } = opts;
  const totalFiltradas = opts.totalFiltradas ?? totalRecetas;
  const recetaRows = Array.from({ length: recetas }, (_, i) => ({
    id: `r${i}`,
    numero_interno: String(120 - i),
    estado: "PREPARADA",
    consumido: "12.5",
    preparada_en: new Date("2026-10-01T15:00:00Z"),
    medico_apellido: "Gómez",
    medico_nombre: "Ana",
  }));

  const tx = {
    droga: {
      findUnique: vi.fn(async () => (droga ? { id: DROGA, nombre: "Minoxidil", fechaBaja: null, unidadBaseId: "u-g", unidadBase: { simbolo: "g" } } : null)),
    },
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("AS total_recetas")) return [{ total_recetas: totalRecetas, total_filtradas: totalFiltradas }];
      if (sql.includes("AS consumido")) return recetaRows;
      if (sql.includes("fsj.paciente")) return [{ receta_id: "r0", apellido: "Pérez", nombre: "Juan" }];
      if (sql.includes("GROUP BY ir.receta_id, p.id")) {
        return [
          { receta_id: "r0", partida_id: PARTIDA_A, lote: "L-1", fecha_vencimiento: new Date("2027-01-31T00:00:00Z"), proveedor: "Droguería Sur", cantidad: "7.5" },
          { receta_id: "r0", partida_id: PARTIDA_B, lote: "L-2", fecha_vencimiento: null, proveedor: "Química Norte", cantidad: "5" },
        ];
      }
      if (sql.includes("AS proveedor")) return opciones;
      throw new Error(`unexpected raw query: ${sql}`);
    }),
  };
  return tx;
}

type FakeTx = ReturnType<typeof fakeTx>;
const asTx = (tx: FakeTx) => tx as unknown as Prisma.TransactionClient;
const NO_PACIENTES = { pacientes: false };
const CON_PACIENTES = { pacientes: true };

const rawSql = (tx: FakeTx) => tx.$queryRaw.mock.calls.map((c) => (c as unknown as [TemplateStringsArray, ...unknown[]])[0].join("?"));
const rawCalls = (tx: FakeTx) => tx.$queryRaw.mock.calls as unknown as [TemplateStringsArray, ...unknown[]][];
const find = (tx: FakeTx, marker: string) => {
  const idx = rawSql(tx).findIndex((s) => s.includes(marker));
  return { idx, sql: rawSql(tx)[idx]!, values: rawCalls(tx)[idx]?.slice(1) ?? [] };
};

describe("getHistorialDrogaCruda", () => {
  it("returns null (and reads nothing else) when the droga is not in the tenant", async () => {
    const tx = fakeTx({ droga: false });
    expect(await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES)).toBeNull();
    expect(tx.droga.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: DROGA, tenantId: TENANT } }));
    expect(tx.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("uses an explicit select on every Prisma call (no bare find, no include)", async () => {
    const tx = fakeTx();
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    for (const fn of [tx.droga.findUnique, tx.tenant.findUniqueOrThrow]) {
      const arg = (fn.mock.calls[0] as unknown as [{ select?: unknown; include?: unknown }])[0];
      expect(arg.select).toBeDefined();
      expect(arg.include).toBeUndefined();
    }
    expect((tx.droga.findUnique.mock.calls[0] as unknown as [{ select: unknown }])[0].select).toEqual({
      id: true,
      nombre: true,
      fechaBaja: true,
      unidadBaseId: true,
      unidadBase: { select: { simbolo: true } },
    });
  });

  it("returns the header, the tenant time zone, the options and the rows mapped", async () => {
    const tx = fakeTx();
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    expect(r).toMatchObject({
      droga: { id: DROGA, nombre: "Minoxidil", fechaBaja: null, unidadBaseId: "u-g", unidadBaseSimbolo: "g" },
      zonaHoraria: "America/Argentina/Mendoza",
      partidaIds: [],
      totalRecetas: 45,
      totalFiltradas: 45,
      page: 1,
    });
    expect(r!.partidasDisponibles).toEqual([
      { id: PARTIDA_A, lote: "L-1", proveedor: "Droguería Sur", fechaVencimiento: new Date("2027-01-31T00:00:00Z") },
      { id: PARTIDA_B, lote: "L-2", proveedor: "Química Norte", fechaVencimiento: null },
    ]);
    expect(r!.recetas[0]).toEqual({
      id: "r0",
      numeroInterno: "120",
      estado: "PREPARADA",
      preparadaEn: new Date("2026-10-01T15:00:00Z"),
      consumido: "12.5",
      medicoApellido: "Gómez",
      medicoNombre: "Ana",
    });
    expect(r!.partidasConsumidas[0]).toEqual({
      recetaId: "r0",
      partidaId: PARTIDA_A,
      lote: "L-1",
      proveedor: "Droguería Sur",
      fechaVencimiento: new Date("2027-01-31T00:00:00Z"),
      cantidad: "7.5",
    });
    expect(r!.pacientes).toEqual([{ recetaId: "r0", apellido: "Pérez", nombre: "Juan" }]);
  });

  it("batches: options, count, page, detail and paciente are ONE statement each, whatever the page size", async () => {
    const tx = fakeTx({ recetas: 20 });
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    expect(rawSql(tx)).toHaveLength(5);
    expect(tx.droga.findUnique).toHaveBeenCalledTimes(1);
  });

  it("does NOT touch paciente without the permiso: no statement mentions it", async () => {
    const tx = fakeTx();
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    expect(rawSql(tx)).toHaveLength(4);
    for (const sql of rawSql(tx)) expect(sql).not.toMatch(/paciente/i);
    expect(r!.pacientes).toEqual([]);
  });

  it("with the permiso, reads the paciente names in ONE statement over the page's receta ids only", async () => {
    const tx = fakeTx({ recetas: 3 });
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    const { sql, values } = find(tx, "fsj.paciente");
    expect(sql).toContain("r.id = ANY(?::uuid[])");
    expect(sql).toContain("pa.tenant_id = ?::uuid");
    expect(values).toContainEqual(["r0", "r1", "r2"]);
    expect(values).toContain(TENANT);
    expect(sql).not.toMatch(/dni|cuil|email|telefono|fecha_nacimiento|nro_credencial/i); // names only
  });

  it("a droga without consumed partidas reads only the options: no count, page, detail nor paciente", async () => {
    const tx = fakeTx({ opciones: [] });
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    expect(rawSql(tx)).toHaveLength(1);
    expect(r).toMatchObject({ partidasDisponibles: [], partidaIds: [], totalRecetas: 0, totalFiltradas: 0, recetas: [], pacientes: [], partidasConsumidas: [] });
  });

  it("an empty page reads neither detail nor paciente", async () => {
    const tx = fakeTx({ totalRecetas: 0 });
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    expect(rawSql(tx)).toHaveLength(2); // options + count
    expect(r).toMatchObject({ recetas: [], pacientes: [], partidasConsumidas: [] });
  });

  it("the options statement lists the droga's partidas WITH at least one EGRESO_PREPARACION, newest ingreso first, tenant-scoped", async () => {
    const tx = fakeTx();
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    const { sql, values } = find(tx, "AS proveedor");
    expect(sql).toContain("p.tenant_id = ?::uuid");
    expect(sql).toContain("p.droga_id = ?::uuid");
    expect(sql).toContain("EXISTS");
    expect(sql).toContain("m.tipo = 'EGRESO_PREPARACION'");
    expect(sql).toContain("pv.razon_social AS proveedor");
    expect(sql).toContain("ORDER BY p.fecha_ingreso DESC, p.id DESC");
    expect(values).toEqual(expect.arrayContaining([TENANT, DROGA]));
  });

  it("the count statement answers the unfiltered total and the filtered one in a single pass", async () => {
    const tx = fakeTx();
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    const { sql } = find(tx, "AS total_recetas");
    expect(sql).toContain("count(*)::int AS total_recetas");
    expect(sql).toContain("AS total_filtradas");
    expect(sql).toContain("GROUP BY ir.receta_id");
    expect(sql).toContain("m.tipo = 'EGRESO_PREPARACION'");
    expect(sql).toContain("p.droga_id = ?::uuid");
  });

  it("the page statement: one row per receta, SUM in SQL numeric returned as text, latest confirmación, ordered newest first with numero_interno as tie-break", async () => {
    const tx = fakeTx();
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    const { sql } = find(tx, "AS consumido");
    expect(sql).toContain("sum(m.cantidad)");
    expect(sql).toContain("::text AS consumido");
    expect(sql).toContain("max(pr.confirmada_en) AS preparada_en");
    expect(sql).toContain("GROUP BY ir.receta_id");
    expect(sql).toContain("ORDER BY x.preparada_en DESC NULLS LAST, r.numero_interno DESC");
    expect(sql).toContain("r.numero_interno::text AS numero_interno");
    expect(sql).toContain("LIMIT ?::int OFFSET ?::int");
  });

  it("clamps the requested page against the FILTERED total before computing the offset", async () => {
    const tx = fakeTx({ totalRecetas: 45 });
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 99, 20, NO_PACIENTES);
    expect(r!.page).toBe(3);
    const { values } = find(tx, "AS consumido");
    expect(values).toEqual(expect.arrayContaining([20, 40])); // LIMIT 20 OFFSET 40
  });

  it("the detail statement groups by (receta, partida) over the page's receta ids, for THIS droga's egresos only", async () => {
    const tx = fakeTx({ recetas: 2 });
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    const { sql, values } = find(tx, "GROUP BY ir.receta_id, p.id");
    expect(sql).toContain("m.tipo = 'EGRESO_PREPARACION'");
    expect(sql).toContain("p.droga_id = ?::uuid");
    expect(sql).toContain("ir.receta_id = ANY(?::uuid[])");
    expect(sql).toContain("sum(m.cantidad)::text AS cantidad");
    expect(values).toContainEqual(["r0", "r1"]);
    expect(values).toEqual(expect.arrayContaining([TENANT, DROGA]));
  });

  describe("filtro por partida", () => {
    it("without a filter the same statements bind an EMPTY id array (the SQL switches on cardinality, no string building)", async () => {
      const tx = fakeTx();
      const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
      expect(r!.partidaIds).toEqual([]);
      const count = find(tx, "AS total_recetas");
      expect(count.sql).toContain("cardinality(?::uuid[]) = 0");
      expect(count.values).toContainEqual([]);
      expect(find(tx, "AS consumido").values).toContainEqual([]);
    });

    it("applies the requested ids that are the droga's own options to the count and to the page", async () => {
      const tx = fakeTx({ totalRecetas: 90, totalFiltradas: 41 });
      const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 3, 20, NO_PACIENTES, [PARTIDA_B]);
      expect(r).toMatchObject({ partidaIds: [PARTIDA_B], totalRecetas: 90, totalFiltradas: 41, page: 3 });
      expect(find(tx, "AS total_recetas").values).toContainEqual([PARTIDA_B]);
      const page = find(tx, "AS consumido");
      expect(page.values).toContainEqual([PARTIDA_B]);
      expect(page.sql).toContain("bool_or(m.partida_id = ANY(?::uuid[]))");
    });

    it("ignores ids that are not one of the droga's options (never trusted): they reach no statement", async () => {
      const tx = fakeTx();
      const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES, [PARTIDA_AJENA, PARTIDA_A]);
      expect(r!.partidaIds).toEqual([PARTIDA_A]);
      for (const call of rawCalls(tx)) {
        expect(call.slice(1)).not.toContain(PARTIDA_AJENA);
        expect(call.slice(1)).not.toContainEqual([PARTIDA_AJENA, PARTIDA_A]);
      }
    });

    it("a filter made only of foreign ids is no filter at all", async () => {
      const tx = fakeTx();
      const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES, [PARTIDA_AJENA]);
      expect(r!.partidaIds).toEqual([]);
      expect(find(tx, "AS total_recetas").values).toContainEqual([]);
      for (const call of rawCalls(tx)) expect(call.slice(1)).not.toContain(PARTIDA_AJENA);
    });

    it("the filter selects recetas, it does not trim them: the detail statement never receives the filter", async () => {
      const tx = fakeTx();
      await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES, [PARTIDA_A]);
      const detail = find(tx, "GROUP BY ir.receta_id, p.id");
      expect(detail.values).not.toContainEqual([PARTIDA_A]);
      expect(detail.sql).not.toContain("cardinality");
      expect(detail.sql).not.toContain("bool_or");
    });
  });

  describe("tenant discipline and explicit columns", () => {
    it("every statement binds the tenant id", async () => {
      const tx = fakeTx();
      await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
      rawCalls(tx).forEach((call, i) => {
        expect(call.slice(1), `statement #${i}`).toContain(TENANT);
        expect(call[0].join("?"), `statement #${i}`).toMatch(/tenant_id = \?::uuid/);
      });
    });

    it("EVERY JOIN carries its own tenant_id, and every FROM of a table is tenant-filtered", async () => {
      const tx = fakeTx();
      await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
      for (const sql of rawSql(tx)) {
        const joins = sql.match(/JOIN fsj\.\w+ \w+/g) ?? [];
        const scopedJoins = sql.match(/JOIN fsj\.\w+ (\w+) ON \1\.tenant_id = \?::uuid/g) ?? [];
        expect(scopedJoins.length, sql).toBe(joins.length);
        for (const m of sql.matchAll(/FROM fsj\.\w+ (\w+)/g)) {
          expect(sql, `FROM alias ${m[1]}`).toMatch(new RegExp(`${m[1]}\\.tenant_id = \\?::uuid`));
        }
      }
    });

    it("no wildcard, and no free-text or unrelated receta columns are read", async () => {
      const tx = fakeTx();
      await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
      for (const sql of rawSql(tx)) {
        expect(sql).not.toMatch(/SELECT \*|\.\*/);
        expect(sql).not.toMatch(/observacion|motivo_|diagnostico|posologia|descripcion|archivo_adjunto|url_verificacion/i);
      }
    });
  });
});
