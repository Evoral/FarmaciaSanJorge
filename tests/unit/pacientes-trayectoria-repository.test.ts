/**
 * `getTrayectoriaCruda` (modules/pacientes/infrastructure/trayectoria-repository.ts)
 * against a recording fake `tx`: proves the read pattern -- batched (no N+1),
 * every query scoped by tenantId, and the optional blocks queried ONLY when
 * the caller says the session may see them. No DB.
 */
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { getTrayectoriaCruda } from "@/modules/pacientes/infrastructure/trayectoria-repository";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PACIENTE = "22222222-2222-4222-a222-222222222222";

function fakeTx(opts: { paciente?: boolean; recetas?: number; conLote?: boolean } = {}) {
  const { paciente = true, recetas = 2, conLote = true } = opts;
  const recetaRows = Array.from({ length: recetas }, (_, i) => ({
    id: `r${i}`,
    numeroInterno: BigInt(100 + i),
    fechaIngreso: new Date("2026-09-20T12:00:00Z"),
    fechaPrescripcion: new Date("2026-09-19T00:00:00Z"),
    origen: "PRESENCIAL",
    estado: "ENTREGADA",
    motivoAnulacion: null,
    loteArchivoId: conLote ? "l1" : null,
    medico: { nombre: "Ana", apellido: "Gómez" },
  }));
  const tx = {
    paciente: { findUnique: vi.fn(async () => (paciente ? { id: PACIENTE, nombre: "Juan", apellido: "Pérez", dni: null, nroCredencial: null, fechaBaja: null, motivoBaja: null } : null)) },
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
    receta: {
      groupBy: vi.fn(async () => (recetas === 0 ? [] : [{ estado: "ENTREGADA", _count: { _all: recetas }, _max: { fechaIngreso: new Date() } }])),
      findMany: vi.fn(async () => recetaRows),
    },
    itemReceta: {
      findMany: vi.fn(async () => recetaRows.map((r) => ({ id: `i-${r.id}`, recetaId: r.id, descripcion: null, formaFarmaceutica: "CAPSULA", cantidadUnidades: 1, componentes: [{ droga: { nombre: "X" } }] }))),
    },
    $queryRaw: vi.fn(async () => []),
    preparacion: { findMany: vi.fn(async () => []) },
    asientoRecetario: { findMany: vi.fn(async () => []) },
    entrega: { findMany: vi.fn(async () => []) },
    loteArchivoRecetas: { findMany: vi.fn(async () => [{ id: "l1", numero: BigInt(7), estado: "EN_ARCHIVO" }]) },
  };
  return tx;
}

const asTx = (tx: ReturnType<typeof fakeTx>) => tx as unknown as Prisma.TransactionClient;
const NINGUNO = { presupuesto: false, preparacion: false, libro: false, archivo: false };
const TODOS = { presupuesto: true, preparacion: true, libro: true, archivo: true };

describe("getTrayectoriaCruda", () => {
  it("returns null (and reads nothing else) when the paciente is not in the tenant", async () => {
    const tx = fakeTx({ paciente: false });
    expect(await getTrayectoriaCruda(asTx(tx), TENANT, PACIENTE, 1, 10, TODOS)).toBeNull();
    expect(tx.paciente.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PACIENTE, tenantId: TENANT } }));
    expect(tx.receta.groupBy).not.toHaveBeenCalled();
    expect(tx.receta.findMany).not.toHaveBeenCalled();
  });

  it("does NOT query any optional block when the session cannot see them (entrega is always read)", async () => {
    const tx = fakeTx();
    const r = await getTrayectoriaCruda(asTx(tx), TENANT, PACIENTE, 1, 10, NINGUNO);
    expect(tx.$queryRaw).not.toHaveBeenCalled(); // cotizaciones
    expect(tx.preparacion.findMany).not.toHaveBeenCalled();
    expect(tx.asientoRecetario.findMany).not.toHaveBeenCalled();
    expect(tx.loteArchivoRecetas.findMany).not.toHaveBeenCalled();
    expect(tx.entrega.findMany).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ cotizaciones: [], preparaciones: [], asientos: [], lotes: [] });
  });

  it("queries each block exactly once for the whole page (batched, no N+1) when allowed", async () => {
    const tx = fakeTx({ recetas: 10 });
    await getTrayectoriaCruda(asTx(tx), TENANT, PACIENTE, 1, 10, TODOS);
    expect(tx.receta.groupBy).toHaveBeenCalledTimes(1);
    expect(tx.receta.findMany).toHaveBeenCalledTimes(1);
    expect(tx.itemReceta.findMany).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.preparacion.findMany).toHaveBeenCalledTimes(1);
    expect(tx.asientoRecetario.findMany).toHaveBeenCalledTimes(1);
    expect(tx.entrega.findMany).toHaveBeenCalledTimes(1);
    expect(tx.loteArchivoRecetas.findMany).toHaveBeenCalledTimes(1);
  });

  it("scopes every query by tenantId and the paciente's recetas", async () => {
    const tx = fakeTx();
    await getTrayectoriaCruda(asTx(tx), TENANT, PACIENTE, 1, 10, TODOS);
    expect(tx.receta.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, pacienteId: PACIENTE } }));
    expect(tx.receta.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, pacienteId: PACIENTE }, take: 10, skip: 0 }));
    expect(tx.itemReceta.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, recetaId: { in: ["r0", "r1"] } } }));
    expect(tx.preparacion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, itemRecetaId: { in: ["i-r0", "i-r1"] } } }));
    expect(tx.entrega.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, recetaId: { in: ["r0", "r1"] } } }));
    expect(tx.loteArchivoRecetas.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, id: { in: ["l1"] } } }));
    const asientoWhere = (tx.asientoRecetario.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(asientoWhere).toMatchObject({ tenantId: TENANT, origen: "SISTEMA" });
    // raw SQL: the tenant is passed as a bound parameter, in the WHERE of the cotizacion query
    const rawCall = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(rawCall[0].join("?")).toContain("c.tenant_id = ?::uuid");
    expect(rawCall.slice(1)[0]).toBe(TENANT);
  });

  it("never touches the dropped receta física columns: explicit select on receta, groupBy by estado only", async () => {
    const tx = fakeTx();
    await getTrayectoriaCruda(asTx(tx), TENANT, PACIENTE, 1, 10, TODOS);
    const findManyArg = (tx.receta.findMany.mock.calls[0] as unknown as [{ select?: Record<string, unknown>; include?: unknown }])[0];
    expect(findManyArg.include).toBeUndefined();
    expect(findManyArg.select).toBeDefined();
    expect(Object.keys(findManyArg.select!).filter((k) => /fisica/i.test(k))).toEqual([]);
    const groupByArg = (tx.receta.groupBy.mock.calls[0] as unknown as [{ by: string[]; _min?: unknown }])[0];
    expect(groupByArg.by).toEqual(["estado"]);
    expect(JSON.stringify(groupByArg)).not.toMatch(/fisica/i);
  });

  it("every Prisma call in the repository selects explicitly (a bare findMany/findUnique would select the columns schema.prisma still declares)", async () => {
    const tx = fakeTx();
    await getTrayectoriaCruda(asTx(tx), TENANT, PACIENTE, 1, 10, TODOS);
    const calls = [tx.paciente.findUnique, tx.tenant.findUniqueOrThrow, tx.receta.findMany, tx.itemReceta.findMany, tx.preparacion.findMany, tx.asientoRecetario.findMany, tx.entrega.findMany, tx.loteArchivoRecetas.findMany];
    for (const fn of calls) {
      const arg = (fn.mock.calls[0] as unknown as [{ select?: unknown; include?: unknown }])[0];
      expect(arg.select).toBeDefined();
      expect(arg.include).toBeUndefined();
    }
  });

  it("clamps the requested page to the last one before skipping", async () => {
    const tx = fakeTx({ recetas: 23 });
    const r = await getTrayectoriaCruda(asTx(tx), TENANT, PACIENTE, 99, 10, NINGUNO);
    expect(tx.receta.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    expect(r!.page).toBe(3);
  });

  it("an empty paciente reads no recetas/items/blocks", async () => {
    const tx = fakeTx({ recetas: 0 });
    const r = await getTrayectoriaCruda(asTx(tx), TENANT, PACIENTE, 1, 10, TODOS);
    expect(tx.receta.findMany).not.toHaveBeenCalled();
    expect(tx.itemReceta.findMany).not.toHaveBeenCalled();
    expect(tx.entrega.findMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ recetas: [], items: [], grupos: [] });
  });

  it("skips the lote query when no receta of the page belongs to a lote", async () => {
    const tx = fakeTx({ conLote: false });
    await getTrayectoriaCruda(asTx(tx), TENANT, PACIENTE, 1, 10, TODOS);
    expect(tx.loteArchivoRecetas.findMany).not.toHaveBeenCalled();
  });
});
