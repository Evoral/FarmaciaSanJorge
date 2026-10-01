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
import { getTrayectoriaProveedorCruda } from "@/modules/proveedores/infrastructure/trayectoria-repository";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PROVEEDOR = "22222222-2222-4222-a222-222222222222";

interface FakeOpts {
  proveedor?: boolean;
  partidas?: number;
  /** Total partidas the aggregate reports (defaults to `partidas`). */
  totalPartidas?: number;
  controladas?: boolean;
  costos?: boolean;
}

function fakeTx(opts: FakeOpts = {}) {
  const { proveedor = true, partidas = 2, controladas = true } = opts;
  const totalPartidas = opts.totalPartidas ?? partidas;
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
    partida: { findMany: vi.fn(async (arg: { select: Record<string, unknown> }) => partidaRows.map((r) => ("costoUnitario" in arg.select ? r : { ...r, costoUnitario: undefined }))) },
    usuario: { findMany: vi.fn(async () => [{ id: "u1", nombre: "Juan", apellido: "Pérez" }]) },
    registroAuditoria: {
      findMany: vi.fn(async () => [
        {
          id: "a1",
          entidadId: "p0",
          valorAnterior: { costoUnitario: "10" },
          valorNuevo: { costoUnitario: "12.5" },
          motivo: "Factura",
          ocurridoEn: new Date("2026-09-28T12:00:00Z"),
          usuario: { nombre: "Ana", apellido: "Gómez" },
        },
      ]),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("fsj.jornada_actual(") && sql.includes("AS jornada")) return [{ jornada: "2026-10-01" }];
      if (sql.includes("AS partidas")) {
        return [{ partidas: totalPartidas, drogas_distintas: 1, ultimo_ingreso: new Date("2026-09-20T12:00:00Z"), vencidas_con_saldo: 0, por_vencer: 1 }];
      }
      if (sql.includes("AS total_comprado")) return [{ total_comprado: "12500.5", stock_valorizado: "4000" }];
      if (sql.includes("fsj.preparacion pr")) {
        return [{ partida_id: "p0", id: "pr1", estado: "CONFIRMADA", iniciada_en: new Date(), confirmada_en: new Date(), descartada_en: null, total: 1 }];
      }
      if (sql.includes("fsj.asiento_contralor")) return [{ partida_id: "p0", numero_vale_adquisicion: "V-1", numero_asiento: "9" }];
      if (sql.includes("ROW_NUMBER() OVER (PARTITION BY ms.partida_id")) {
        return [
          { id: "m1", partida_id: "p0", tipo: "INGRESO_COMPRA", cantidad: "500", motivo_ajuste: null, observacion: null, registrado_en: new Date(), registrado_por_id: "u1", autorizado_por_id: null, total: 25 },
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
    expect(tx.registroAuditoria.findMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ totales: null, preparaciones: [], contralor: [], auditoria: [] });
    // the base blocks ARE read: jornada, resumen, movimientos
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
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
    expect(tx.registroAuditoria.findMany).toHaveBeenCalledTimes(1);
    const sqls = rawSql(tx);
    // jornada, resumen, totales, movimientos, preparaciones, contralor: one each
    expect(sqls).toHaveLength(6);
    expect(sqls.filter((s) => s.includes("fsj.movimiento_stock ms")).length).toBe(3); // movimientos + preparaciones + contralor, one statement each
  });

  it("reads the movimientos of ALL the page's partidas in one windowed statement, capped at 20 per partida", async () => {
    const tx = fakeTx({ partidas: 10 });
    const r = await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, NINGUNO);
    const idx = rawSql(tx).findIndex((s) => s.includes("ROW_NUMBER() OVER (PARTITION BY ms.partida_id"));
    expect(idx).toBeGreaterThanOrEqual(0);
    const sql = rawSql(tx)[idx]!;
    expect(sql).toContain("ORDER BY ms.registrado_en DESC");
    expect(sql).toContain("COUNT(*) OVER (PARTITION BY ms.partida_id)");
    expect(sql).toContain("rn <= ?::int");
    const values = rawCalls(tx)[idx]!.slice(1);
    expect(values).toContain(20);
    expect(values[1]).toEqual(Array.from({ length: 10 }, (_, i) => `p${i}`)); // all the page's partida ids, one statement
    expect(r!.movimientos[0]).toMatchObject({ partidaId: "p0", totalDePartida: 25 });
  });

  it("scopes every Prisma query by tenantId and the proveedor's partidas", async () => {
    const tx = fakeTx();
    await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS);
    expect(tx.partida.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, proveedorId: PROVEEDOR }, take: 10, skip: 0 }));
    expect(tx.parametro.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_clave: { tenantId: TENANT, clave: "dias_alerta_vencimiento_partida" } } }));
    expect(tx.tenant.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TENANT } }));
    expect(tx.usuario.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, id: { in: ["u1"] } } }));
    expect(tx.registroAuditoria.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, entidad: "partida", entidadId: { in: ["p0", "p1"] }, accion: "MODIFICAR" } }),
    );
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
    const calls = [tx.proveedor.findUnique, tx.tenant.findUniqueOrThrow, tx.parametro.findUnique, tx.partida.findMany, tx.usuario.findMany, tx.registroAuditoria.findMany];
    for (const fn of calls) {
      const arg = (fn.mock.calls[0] as unknown as [{ select?: unknown; include?: unknown }])[0];
      expect(arg.select).toBeDefined();
      expect(arg.include).toBeUndefined();
    }
  });

  it("the audit select leaves out ip and contexto", async () => {
    const tx = fakeTx();
    await getTrayectoriaProveedorCruda(asTx(tx), TENANT, PROVEEDOR, 1, 10, TODOS);
    const select = (tx.registroAuditoria.findMany.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0].select;
    expect(Object.keys(select).sort()).toEqual(["entidadId", "id", "motivo", "ocurridoEn", "usuario", "valorAnterior", "valorNuevo"]);
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
    expect(tx.registroAuditoria.findMany).not.toHaveBeenCalled();
    expect(tx.usuario.findMany).not.toHaveBeenCalled();
    expect(rawSql(tx).some((s) => s.includes("ROW_NUMBER()"))).toBe(false);
    expect(r).toMatchObject({ partidas: [], movimientos: [], preparaciones: [], contralor: [], auditoria: [] });
  });
});

describe("privacy: the view's source never logs", () => {
  const files = [
    "modules/proveedores/domain/trayectoria.ts",
    "modules/proveedores/infrastructure/trayectoria-repository.ts",
    "modules/proveedores/application/get-trayectoria-proveedor.ts",
    "modules/proveedores/ui/trayectoria-encabezado.tsx",
    "modules/proveedores/ui/trayectoria-resumen.tsx",
    "modules/proveedores/ui/trayectoria-partida-card.tsx",
    "app/(app)/proveedores/[id]/trayectoria/page.tsx",
  ];
  for (const file of files) {
    it(`${file} has no logger or console call`, () => {
      const source = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
      expect(source).not.toMatch(/getLogger|shared\/logging|\blogger\.\w+\(|console\./);
    });
  }
});
