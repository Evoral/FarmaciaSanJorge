/**
 * `getTrayectoriaProveedorCruda` (modules/proveedores/infrastructure/trayectoria-repository.ts)
 * against a recording fake `tx`: proves the read pattern -- batched (no N+1),
 * every query scoped by tenantId, EXPLICIT selects everywhere (schema.prisma
 * still declares receta columns the shared DB dropped, and this view must never
 * reach receta/paciente), the optional blocks queried ONLY when the caller says
 * the session may see them, and the per-partida movement cap. No DB.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { CORRECCIONES_POR_PARTIDA_MAX } from "@/modules/proveedores/domain/trayectoria";
import { getTrayectoriaProveedorCruda } from "@/modules/proveedores/infrastructure/trayectoria-repository";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PROVEEDOR = "22222222-2222-4222-a222-222222222222";
const DROGA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DROGA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DROGA_AJENA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

interface FakeOpts {
  proveedor?: boolean;
  partidas?: number;
  /** Total partidas the aggregate reports (defaults to `partidas`). */
  totalPartidas?: number;
  controladas?: boolean;
  costos?: boolean;
  /** Drogas the proveedor has partidas of (what `droga.findMany` answers). */
  drogas?: { id: string; nombre: string }[];
  /** What `partida.count` answers (the filtered total). */
  filtradas?: number;
}

function fakeTx(opts: FakeOpts = {}) {
  const { proveedor = true, partidas = 2, controladas = true } = opts;
  const totalPartidas = opts.totalPartidas ?? partidas;
  const drogas = opts.drogas ?? [
    { id: DROGA_A, nombre: "Ácido hialurónico" },
    { id: DROGA_B, nombre: "Minoxidil" },
  ];
  const partidaRows = Array.from({ length: partidas }, (_, i) => ({
    id: `p${i}`,
    lote: `L${i}`,
    fechaIngreso: new Date("2026-09-20T12:00:00Z"),
    fechaVencimiento: new Date("2027-01-31T00:00:00Z"),
    fechaApertura: null,
    cantidadInicial: { toString: () => "500" },
    cantidadDisponible: { toString: () => "320" },
    costoUnitario: { toString: () => "12.5" },
    droga: { nombre: "Minoxidil", tipoControl: controladas ? "PSICOTROPICO" : "NINGUNO", unidadBaseId: "u-g", unidadBase: { simbolo: "g" } },
  }));

  const tx = {
    proveedor: { findUnique: vi.fn(async () => (proveedor ? { id: PROVEEDOR, razonSocial: "Droguería Sur", cuit: "20123456786", fechaBaja: null, motivoBaja: null } : null)) },
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
    parametro: { findUnique: vi.fn(async () => ({ valor: "45" })) },
    partida: {
      findMany: vi.fn(async (arg: { select: Record<string, unknown> }) => partidaRows.map((r) => ("costoUnitario" in arg.select ? r : { ...r, costoUnitario: undefined }))),
      count: vi.fn(async () => opts.filtradas ?? totalPartidas),
    },
    droga: { findMany: vi.fn(async () => drogas) },
    usuario: { findMany: vi.fn(async () => [{ id: "u1", nombre: "Juan", apellido: "Pérez" }]) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("fsj.jornada_actual(") && sql.includes("AS jornada")) return [{ jornada: "2026-10-01" }];
      if (sql.includes("AS partidas")) {
        return [{ partidas: totalPartidas, drogas_distintas: 1, ultimo_ingreso: new Date("2026-09-20T12:00:00Z"), vencidas_con_saldo: 0, por_vencer: 1 }];
      }
      if (sql.includes("AS total_comprado")) return [{ total_comprado: "12500.5", stock_valorizado: "4000" }];
      if (sql.includes("fsj.registro_auditoria")) {
        return [
          {
            id: "a1",
            partida_id: "p0",
            valor_anterior: { costoUnitario: "10" },
            valor_nuevo: { costoUnitario: "12.5" },
            motivo: "Factura",
            ocurrido_en: new Date("2026-09-28T12:00:00Z"),
            nombre: "Ana",
            apellido: "Gómez",
          },
        ];
      }
      if (sql.includes("count(DISTINCT ms.preparacion_id)")) return [{ partida_id: "p0", total: 7 }];
      if (sql.includes("fsj.preparacion pr")) {
        return [{ partida_id: "p0", id: "pr1", estado: "CONFIRMADA", iniciada_en: new Date(), confirmada_en: new Date(), descartada_en: null }];
      }
      if (sql.includes("fsj.asiento_contralor")) return [{ partida_id: "p0", numero_vale_adquisicion: "V-1", numero_asiento: "9" }];
      if (sql.includes("count(*)::int AS total")) return [{ partida_id: "p0", total: 25 }];
      if (sql.includes("ms.tipo::text AS tipo")) {
        return [
          { id: "m1", partida_id: "p0", tipo: "INGRESO_COMPRA", cantidad: "500", motivo_ajuste: null, observacion: null, registrado_en: new Date(), registrado_por_id: "u1", autorizado_por_id: null },
        ];
      }
      throw new Error(`unexpected raw query: ${sql}`);
    }),
  };
  return tx;
}

type FakeTx = ReturnType<typeof fakeTx>;
const asTx = (tx: FakeTx) => tx as unknown as Prisma.TransactionClient;
const NINGUNO = { costos: false, preparaciones: false, contralor: false, correcciones: false };
const TODOS = { costos: true, preparaciones: true, contralor: true, correcciones: true };

const rawSql = (tx: FakeTx) => tx.$queryRaw.mock.calls.map((c) => (c as unknown as [TemplateStringsArray, ...unknown[]])[0].join("?"));
const rawCalls = (tx: FakeTx) => tx.$queryRaw.mock.calls as unknown as [TemplateStringsArray, ...unknown[]][];

describe("getTrayectoriaProveedorCruda", () => {
  it("returns null (and reads nothing else) when the proveedor is not in the tenant", async () => {
    const tx = fakeTx({ proveedor: false });
    expect(await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS)).toBeNull();
    expect(tx.proveedor.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PROVEEDOR, tenantId: TENANT } }));
    expect(tx.partida.findMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("does NOT query any optional block when the session cannot see them", async () => {
    const tx = fakeTx();
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    const sqls = rawSql(tx);
    expect(sqls.some((s) => s.includes("AS total_comprado"))).toBe(false); // money
    expect(sqls.some((s) => s.includes("fsj.preparacion pr"))).toBe(false);
    expect(sqls.some((s) => s.includes("fsj.asiento_contralor"))).toBe(false);
    expect(sqls.some((s) => s.includes("fsj.registro_auditoria"))).toBe(false);
    expect(r).toMatchObject({ totales: null, preparaciones: [], contralor: [], auditoria: [] });
    // the base blocks ARE read: jornada, resumen, movimientos (+ their grouped totals)
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it("never selects costo_unitario without stock.valorizado.ver (page select), and selects it with it", async () => {
    const sin = fakeTx();
    await getTrayectoriaProveedorCruda(asTx(sin), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    const selSin = (sin.partida.findMany.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0].select;
    expect(selSin).not.toHaveProperty("costoUnitario");

    const con = fakeTx();
    const r = await getTrayectoriaProveedorCruda(asTx(con), TENANT, PROVEEDOR, 1, 10, TODOS);
    const selCon = (con.partida.findMany.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0].select;
    expect(selCon).toHaveProperty("costoUnitario", true);
    expect(r!.partidas[0]!.costoUnitario).toBe("12.5");

    const rSin = await getTrayectoriaProveedorCruda(asTx(fakeTx()), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    expect(rSin!.partidas[0]!.costoUnitario).toBeNull();
  });

  it("queries each block exactly once for the whole page (batched, no N+1) when allowed", async () => {
    const tx = fakeTx({ partidas: 10 });
    await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS);
    expect(tx.partida.findMany).toHaveBeenCalledTimes(1);
    expect(tx.usuario.findMany).toHaveBeenCalledTimes(1);
    const sqls = rawSql(tx);
    // jornada, resumen, money, movimientos + total, preparaciones + total, contralor, cost corrections: one statement each, whatever the page size
    expect(sqls).toHaveLength(9);
    expect(sqls.filter((s) => s.includes("fsj.registro_auditoria")).length).toBe(1);
  });

  it("reads the latest 20 movimientos of EACH partida with a bounded LATERAL (no scan of the whole history), and the totals in a separate grouped count", async () => {
    const tx = fakeTx({ partidas: 10 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    const idx = rawSql(tx).findIndex((s) => s.includes("ms.tipo::text AS tipo"));
    expect(idx).toBeGreaterThanOrEqual(0);
    const sql = rawSql(tx)[idx]!;
    expect(sql).toContain("unnest(?::uuid[]) AS p(id)");
    expect(sql).toContain("CROSS JOIN LATERAL");
    expect(sql).toContain("ms.tenant_id = ?::uuid AND ms.partida_id = p.id");
    expect(sql).toContain("ORDER BY ms.registrado_en DESC, ms.id DESC");
    expect(sql).toContain("LIMIT ?::int");
    expect(sql).not.toMatch(/ROW_NUMBER|COUNT\(\*\) OVER/); // no window over the full history
    const values = rawCalls(tx)[idx]!.slice(1);
    expect(values[0]).toEqual(Array.from({ length: 10 }, (_, i) => `p${i}`)); // all the page's partida ids, one statement
    expect(values).toContain(TENANT);
    expect(values).toContain(20);

    const totIdx = rawSql(tx).findIndex((s) => s.includes("count(*)::int AS total"));
    expect(totIdx).toBeGreaterThanOrEqual(0);
    const totSql = rawSql(tx)[totIdx]!;
    expect(totSql).toContain("ms.tenant_id = ?::uuid AND ms.partida_id = ANY(?::uuid[])");
    expect(totSql).toContain("GROUP BY ms.partida_id");
    expect(rawCalls(tx)[totIdx]!.slice(1)).toEqual(expect.arrayContaining([TENANT, Array.from({ length: 10 }, (_, i) => `p${i}`)]));
    expect(r!.movimientos[0]).toMatchObject({ partidaId: "p0", totalDePartida: 25 });
  });

  it("bounds the preparaciones lookup the same way: LATERAL LIMIT over the partida's latest preparacion movements, total in a grouped count(DISTINCT)", async () => {
    const tx = fakeTx({ partidas: 3 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, { ...NINGUNO, preparaciones: true });
    const idx = rawSql(tx).findIndex((s) => s.includes("fsj.preparacion pr"));
    const sql = rawSql(tx)[idx]!;
    expect(sql).toContain("CROSS JOIN LATERAL");
    expect(sql).toContain("ms.tenant_id = ?::uuid AND ms.partida_id = p.id AND ms.preparacion_id IS NOT NULL");
    expect(sql).toContain("ORDER BY ms.registrado_en DESC, ms.id DESC");
    expect(sql).toContain("LIMIT ?::int");
    expect(sql).not.toMatch(/SELECT DISTINCT/); // the old unbounded scan
    expect(rawCalls(tx)[idx]!.slice(1)).toContain(20);
    const totSql = rawSql(tx).find((s) => s.includes("count(DISTINCT ms.preparacion_id)"))!;
    expect(totSql).toContain("ms.tenant_id = ?::uuid");
    expect(totSql).toContain("GROUP BY ms.partida_id");
    expect(r!.preparaciones[0]).toMatchObject({ partidaId: "p0", id: "pr1", totalDePartida: 7 });
  });

  it("filters the cost corrections IN SQL (entidad partida, MODIFICAR, diff with costoUnitario), bounded per partida, tenant-scoped", async () => {
    const tx = fakeTx({ partidas: 4 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, { ...NINGUNO, correcciones: true });
    const idx = rawSql(tx).findIndex((s) => s.includes("fsj.registro_auditoria"));
    const sql = rawSql(tx)[idx]!;
    expect(sql).toContain("ra.tenant_id = ?::uuid");
    expect(sql).toContain("ra.entidad = 'partida'");
    expect(sql).toContain("ra.entidad_id = p.id");
    expect(sql).toContain("ra.accion = 'MODIFICAR'");
    expect(sql).toContain("jsonb_exists(ra.valor_nuevo, 'costoUnitario') OR jsonb_exists(ra.valor_anterior, 'costoUnitario')");
    expect(sql).toContain("CROSS JOIN LATERAL");
    expect(sql).toContain("ORDER BY ra.ocurrido_en DESC, ra.id DESC");
    expect(sql).toContain("LIMIT ?::int");
    expect(sql).toContain("u.tenant_id = ?::uuid AND u.id = a.usuario_id");
    expect(sql).not.toMatch(/\bip\b|contexto|SELECT \*|\.\*/); // no ip / contexto / wildcard
    const values = rawCalls(tx)[idx]!.slice(1);
    expect(values[0]).toEqual(["p0", "p1", "p2", "p3"]);
    expect(values).toContain(TENANT);
    expect(values).toContain(CORRECCIONES_POR_PARTIDA_MAX + 1); // one extra row to know there are more
    expect(r!.auditoria[0]).toMatchObject({ id: "a1", partidaId: "p0", usuarioNombre: "Ana", usuarioApellido: "Gómez" });
  });

  it("scopes every Prisma query by tenantId and the proveedor's partidas", async () => {
    const tx = fakeTx();
    await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS);
    expect(tx.partida.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, proveedorId: PROVEEDOR }, take: 10, skip: 0 }));
    expect(tx.parametro.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_clave: { tenantId: TENANT, clave: "dias_alerta_vencimiento_partida" } } }));
    expect(tx.tenant.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TENANT } }));
    expect(tx.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, id: { in: ["u1"] } } }));
  });

  it("orders the page newest first with an id tie-break, so pages are stable", async () => {
    const tx = fakeTx();
    await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    expect(tx.partida.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ fechaIngreso: "desc" }, { id: "desc" }] }));
  });

  it("scopes every raw SQL by the bound tenant id, with the tenant as the first parameter of the statement", async () => {
    const tx = fakeTx();
    await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS);
    rawCalls(tx).forEach((call, i) => {
      expect(call[0].join("?"), `statement #${i}`).toMatch(/tenant_id = \?::uuid|jornada_actual\(\?::uuid\)/);
      expect(call.slice(1), `statement #${i}`).toContain(TENANT);
    });
  });

  it("the aggregate filters partidas by tenant AND proveedor, and counts the alerts against the jornada read once", async () => {
    const tx = fakeTx();
    await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    const idx = rawSql(tx).findIndex((s) => s.includes("AS partidas"));
    const sql = rawSql(tx)[idx]!;
    expect(sql).toContain("p.tenant_id = ?::uuid AND p.proveedor_id = ?::uuid");
    expect(rawCalls(tx)[idx]!.slice(1)).toEqual(expect.arrayContaining(["2026-10-01", 45, TENANT, PROVEEDOR]));
    // same predicates as alertasVencidasConSaldo / alertasPorVencer
    expect(sql).toContain("p.cantidad_disponible > 0 AND p.fecha_vencimiento < ?::date");
    expect(sql).toContain("p.fecha_vencimiento >= ?::date");
    expect(sql).toContain("(?::int || ' days')::interval");
  });

  it("uses the stock alert window (parametro) and the tenant jornada for the estado derivation", async () => {
    const tx = fakeTx();
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    expect(r).toMatchObject({ jornada: "2026-10-01", diasAlerta: 45, zonaHoraria: "America/Argentina/Mendoza" });
  });

  it("falls back to the default window when the tenant has no parametro row", async () => {
    const tx = fakeTx();
    tx.parametro.findUnique.mockResolvedValueOnce(null as never);
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    expect(r!.diasAlerta).toBe(30);
  });

  it("money is computed in SQL numeric and returned as text (never summed in JS)", async () => {
    const tx = fakeTx();
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS);
    const sql = rawSql(tx).find((s) => s.includes("AS total_comprado"))!;
    expect(sql).toContain("sum(p.cantidad_inicial * p.costo_unitario)");
    expect(sql).toContain("sum(p.cantidad_disponible * p.costo_unitario)");
    expect(sql).toContain("::text AS total_comprado");
    expect(r!.totales).toEqual({ totalComprado: "12500.5", stockValorizado: "4000" });
  });

  it("explicit select on EVERY Prisma call: no bare findMany/findUnique, no include", async () => {
    const tx = fakeTx();
    await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS);
    const calls = [tx.proveedor.findUnique, tx.tenant.findUniqueOrThrow, tx.parametro.findUnique, tx.partida.findMany, tx.usuario.findMany, tx.droga.findMany];
    for (const fn of calls) {
      const arg = (fn.mock.calls[0] as unknown as [{ select?: unknown; include?: unknown }])[0];
      expect(arg.select).toBeDefined();
      expect(arg.include).toBeUndefined();
    }
  });

  it("never reaches receta / paciente: no raw SQL mentions them, and preparaciones stop at fsj.preparacion with only id, estado and dates", async () => {
    const tx = fakeTx();
    await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS);
    for (const sql of rawSql(tx)) {
      expect(sql).not.toMatch(/receta|paciente|cotizacion|entrega/i);
    }
    const prepSql = rawSql(tx).find((s) => s.includes("fsj.preparacion pr"))!;
    expect(prepSql).toContain("pr.estado::text AS estado");
    expect(prepSql).toContain("pr.iniciada_en");
    expect(prepSql).toContain("pr.confirmada_en");
    expect(prepSql).toContain("pr.descartada_en");
    expect(prepSql).toContain("ms.preparacion_id IS NOT NULL");
    expect(prepSql).not.toContain("motivo_descarte"); // free text, not needed
    expect(prepSql).not.toMatch(/item_receta|ficha_tecnica/);
  });

  it("only asks the contralor for the CONTROLLED partidas, and not at all when none is", async () => {
    const conControladas = fakeTx({ controladas: true });
    await getTrayectoriaProveedorCruda(asTx(conControladas), TENANT, PROVEEDOR, 1, 10, TODOS);
    expect(rawSql(conControladas).some((s) => s.includes("fsj.asiento_contralor"))).toBe(true);

    const sinControladas = fakeTx({ controladas: false });
    await getTrayectoriaProveedorCruda(asTx(sinControladas), TENANT, PROVEEDOR, 1, 10, TODOS);
    expect(rawSql(sinControladas).some((s) => s.includes("fsj.asiento_contralor"))).toBe(false);
  });

  it("clamps the requested page to the last one before skipping", async () => {
    const tx = fakeTx({ partidas: 3, totalPartidas: 23 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 99, 10, NINGUNO);
    expect(tx.partida.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    expect(r!.page).toBe(3);
  });

  it("an empty proveedor reads no partidas and none of the per-partida blocks", async () => {
    const tx = fakeTx({ partidas: 0 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS);
    expect(tx.partida.findMany).not.toHaveBeenCalled();
    expect(tx.usuario.findMany).not.toHaveBeenCalled();
    expect(rawSql(tx).some((s) => s.includes("fsj.registro_auditoria") || s.includes("CROSS JOIN LATERAL"))).toBe(false);
    expect(r).toMatchObject({ partidas: [], movimientos: [], preparaciones: [], contralor: [], auditoria: [] });
  });
});

describe("getTrayectoriaProveedorCruda -- filtro por droga", () => {
  const firstArg = <T,>(fn: { mock: { calls: unknown[][] } }) => fn.mock.calls[0]![0] as T;

  it("lists the proveedor's distinct drogas with an explicit select, tenant + proveedor scoped, ordered by name, NOT narrowed by the filter", async () => {
    const tx = fakeTx();
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO, [DROGA_B]);
    expect(tx.droga.findMany).toHaveBeenCalledTimes(1);
    const arg = firstArg<{ where: unknown; select: unknown; orderBy: unknown }>(tx.droga.findMany);
    expect(arg.where).toEqual({ tenantId: TENANT, partidas: { some: { tenantId: TENANT, proveedorId: PROVEEDOR } } });
    expect(arg.select).toEqual({ id: true, nombre: true });
    expect(arg.orderBy).toEqual([{ nombre: "asc" }, { id: "asc" }]);
    expect(r!.drogasDisponibles).toEqual([
      { id: DROGA_A, nombre: "Ácido hialurónico" },
      { id: DROGA_B, nombre: "Minoxidil" },
    ]);
  });

  it("without a filter: where is exactly tenant + proveedor, no count query, pagination over the proveedor-wide total", async () => {
    const tx = fakeTx({ partidas: 3, totalPartidas: 23 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    expect(firstArg<{ where: unknown }>(tx.partida.findMany).where).toEqual({ tenantId: TENANT, proveedorId: PROVEEDOR });
    expect(tx.partida.count).not.toHaveBeenCalled();
    expect(r).toMatchObject({ drogaIds: [], totalFiltrado: 23 });
  });

  it("with a filter: drogaId IN (...) on the page query AND on its count; pagination follows the filtered total, the resumen does not", async () => {
    const tx = fakeTx({ partidas: 3, totalPartidas: 23, filtradas: 12 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 2, 10, TODOS, [DROGA_A, DROGA_B]);
    const where = { tenantId: TENANT, proveedorId: PROVEEDOR, drogaId: { in: [DROGA_A, DROGA_B] } };
    expect(tx.partida.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 10, take: 10 }));
    expect(tx.partida.count).toHaveBeenCalledWith({ where });
    expect(r).toMatchObject({ drogaIds: [DROGA_A, DROGA_B], totalFiltrado: 12, page: 2 });
    // the resumen (counters and money) is proveedor-wide: no raw statement filters by droga, no droga id is bound
    expect(r!.resumen.partidas).toBe(23);
    for (const call of rawCalls(tx)) {
      expect(call[0].join("?")).not.toMatch(/droga_ids*(=|IN|<>)/i); // count(DISTINCT p.droga_id) is fine: it is a counter, not a filter
      expect(call.slice(1)).not.toContain(DROGA_A);
      expect(call.slice(1)).not.toContainEqual([DROGA_A, DROGA_B]);
    }
  });

  it("clamps the page against the FILTERED total before skipping", async () => {
    const tx = fakeTx({ partidas: 3, totalPartidas: 50, filtradas: 11 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 99, 10, NINGUNO, [DROGA_A]);
    expect(tx.partida.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    expect(r!.page).toBe(2);
  });

  it("ignores ids that are not one of the proveedor's drogas (never trusted): only the own ones reach the queries", async () => {
    const tx = fakeTx({ filtradas: 2 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO, [DROGA_AJENA, DROGA_B]);
    expect(tx.partida.count).toHaveBeenCalledWith({ where: { tenantId: TENANT, proveedorId: PROVEEDOR, drogaId: { in: [DROGA_B] } } });
    expect(r!.drogaIds).toEqual([DROGA_B]);
  });

  it("a filter made only of foreign ids is no filter at all (no count, full list)", async () => {
    const tx = fakeTx({ partidas: 4 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO, [DROGA_AJENA]);
    expect(tx.partida.count).not.toHaveBeenCalled();
    expect(firstArg<{ where: unknown }>(tx.partida.findMany).where).toEqual({ tenantId: TENANT, proveedorId: PROVEEDOR });
    expect(r).toMatchObject({ drogaIds: [], totalFiltrado: 4 });
  });

  it("a proveedor without partidas reads no drogas and no count", async () => {
    const tx = fakeTx({ partidas: 0 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO, [DROGA_A]);
    expect(tx.droga.findMany).not.toHaveBeenCalled();
    expect(tx.partida.count).not.toHaveBeenCalled();
    expect(r).toMatchObject({ drogasDisponibles: [], drogaIds: [], totalFiltrado: 0, partidas: [] });
  });
});

describe("privacy: the view's source never logs", () => {
  const files = [
    "modules/proveedores/domain/trayectoria.ts",
    "modules/proveedores/infrastructure/trayectoria-repository.ts",
    "modules/proveedores/application/get-trayectoria-proveedor.ts",
    "modules/proveedores/ui/trayectoria-encabezado.tsx",
    "modules/proveedores/ui/trayectoria-resumen.tsx",
    "modules/proveedores/ui/trayectoria-partida-fila.tsx",
    "modules/proveedores/ui/trayectoria-filtro-drogas.tsx",
    "app/(app)/proveedores/[id]/trayectoria/page.tsx",
  ];
  for (const file of files) {
    it(`${file} has no logger or console call`, () => {
      const source = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
      expect(source).not.toMatch(/getLogger|shared\/logging|\blogger\.\w+\(|console\./);
    });
  }
});
