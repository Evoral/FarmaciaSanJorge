/**
 * `getRecurrentesCrudos` (modules/pacientes/infrastructure/recurrentes-repository.ts)
 * against a recording fake `tx`: proves the read pattern -- ONE batched read of
 * items, every `where` scoped by tenantId (nested relations included), ANULADA,
 * baja and the 12-month window filtered in the query -- and, above all, that
 * every Prisma call selects EXPLICITLY. `schema.prisma` still declares the
 * `receta_fisica_recibida*` columns another migration dropped from the shared
 * database, so a bare `findMany`, an `include` or a `groupBy` over them would
 * fail at runtime with "column does not exist". No DB.
 */
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { getRecurrentesCrudos } from "@/modules/pacientes/infrastructure/recurrentes-repository";

const TENANT = "11111111-1111-4111-8111-111111111111";
const AHORA = new Date("2026-10-01T15:00:00Z"); // 2026-10-01 12:00 in Mendoza

function fakeTx(opts: { nombreFantasia?: string | null } = {}) {
  const { nombreFantasia = "Farmacia San José" } = opts;
  const row = {
    id: "item-1",
    descripcion: null,
    formaFarmaceutica: "CAPSULA",
    duracionTratamientoDias: 30,
    componentes: [
      { drogaId: "d1", cantidad: { toString: () => "3" }, unidadMedidaId: "u1", modoExpresion: "TOTAL", droga: { nombre: "Melatonina" }, unidadMedida: { simbolo: "mg" } },
      { drogaId: "d2", cantidad: null, unidadMedidaId: "u1", modoExpresion: "CSP", droga: { nombre: "Lactosa" }, unidadMedida: { simbolo: "mg" } },
    ],
    receta: {
      id: "r1",
      fechaIngreso: new Date("2026-09-01T15:00:00Z"),
      estado: "ENTREGADA",
      paciente: { id: "p1", nombre: "Ana", apellido: "Suárez", telefono: "011 15-1234-5678", aceptaRecordatoriosWhatsapp: true, fechaBaja: null },
    },
  };
  return {
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza", nombreFantasia, razonSocial: "San José S.R.L." })) },
    itemReceta: { findMany: vi.fn(async () => [row]) },
    // Tripwires: nothing else of the receta graph may be queried.
    receta: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    paciente: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  };
}

const asTx = (tx: ReturnType<typeof fakeTx>) => tx as unknown as Prisma.TransactionClient;

type FindManyArg = { where: Record<string, unknown>; select?: Record<string, unknown>; include?: unknown };
const findManyArg = (tx: ReturnType<typeof fakeTx>) => (tx.itemReceta.findMany.mock.calls[0] as unknown as [FindManyArg])[0];

/** Every key (at any depth) of a JSON-like structure. */
function allKeys(value: unknown, into: string[] = []): string[] {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      into.push(k);
      allKeys(v, into);
    }
  }
  return into;
}

describe("getRecurrentesCrudos", () => {
  it("reads the whole window with ONE items query (batched, no N+1) plus the tenant row", async () => {
    const tx = fakeTx();
    await getRecurrentesCrudos(asTx(tx), TENANT, AHORA);
    expect(tx.itemReceta.findMany).toHaveBeenCalledTimes(1);
    expect(tx.tenant.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    for (const fn of [tx.receta.findMany, tx.receta.findUnique, tx.receta.findFirst, tx.receta.groupBy, tx.receta.count, tx.paciente.findMany, tx.paciente.findUnique, tx.paciente.findFirst, tx.$queryRaw]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("scopes by tenantId at every level and filters ANULADA, baja and the 12-month window in the query", async () => {
    const tx = fakeTx();
    await getRecurrentesCrudos(asTx(tx), TENANT, AHORA);
    expect(tx.tenant.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TENANT } }));
    expect(findManyArg(tx).where).toEqual({
      tenantId: TENANT,
      receta: {
        is: {
          tenantId: TENANT,
          estado: { not: "ANULADA" },
          // 12 months back from 2026-10-01, at local (Mendoza, UTC-3) midnight.
          fechaIngreso: { gte: new Date("2025-10-01T03:00:00.000Z") },
          paciente: { is: { tenantId: TENANT, fechaBaja: null } },
        },
      },
    });
  });

  it("never touches the dropped receta física columns: every call has an explicit select, no include, no *fisica* key anywhere", async () => {
    const tx = fakeTx();
    await getRecurrentesCrudos(asTx(tx), TENANT, AHORA);

    for (const fn of [tx.itemReceta.findMany, tx.tenant.findUniqueOrThrow]) {
      const arg = (fn.mock.calls[0] as unknown as [FindManyArg])[0];
      expect(arg.select).toBeDefined();
      expect(arg.include).toBeUndefined();
      expect(allKeys(arg).filter((k) => /fisica/i.test(k))).toEqual([]);
    }

    // The nested receta (the model that still declares the dropped columns) is selected field by field too.
    const { select } = findManyArg(tx);
    const receta = select!.receta as { select?: Record<string, unknown>; include?: unknown };
    expect(receta.include).toBeUndefined();
    expect(Object.keys(receta.select!).sort()).toEqual(["estado", "fechaIngreso", "id", "paciente"]);
    const paciente = receta.select!.paciente as { select?: Record<string, unknown> };
    expect(Object.keys(paciente.select!).sort()).toEqual(["aceptaRecordatoriosWhatsapp", "apellido", "fechaBaja", "id", "nombre", "telefono"]);
    // No `true` shorthand for a whole relation (that would select all of its columns).
    expect(JSON.stringify(select)).not.toMatch(/"(receta|paciente|droga|unidadMedida|componentes)":true/);
  });

  it("reads the componentes the signature needs: droga nombre, cantidad, unidad and modo, in order", async () => {
    const tx = fakeTx();
    await getRecurrentesCrudos(asTx(tx), TENANT, AHORA);
    const componentes = findManyArg(tx).select!.componentes as { orderBy: unknown; select: Record<string, unknown> };
    expect(componentes.orderBy).toEqual({ orden: "asc" });
    expect(Object.keys(componentes.select).sort()).toEqual(["cantidad", "droga", "drogaId", "modoExpresion", "unidadMedida", "unidadMedidaId"]);
  });

  it("maps rows to the raw shape: decimal as string (null stays null), tenant zone and farmacia display name", async () => {
    const tx = fakeTx();
    const crudos = await getRecurrentesCrudos(asTx(tx), TENANT, AHORA);
    expect(crudos.zonaHoraria).toBe("America/Argentina/Mendoza");
    expect(crudos.farmaciaNombre).toBe("Farmacia San José");
    expect(crudos.items).toHaveLength(1);
    expect(crudos.items[0]).toMatchObject({
      id: "item-1",
      duracionTratamientoDias: 30,
      receta: { id: "r1", estado: "ENTREGADA" },
      paciente: { id: "p1", aceptaRecordatoriosWhatsapp: true, telefono: "011 15-1234-5678" },
    });
    expect(crudos.items[0]!.componentes).toEqual([
      { drogaId: "d1", drogaNombre: "Melatonina", cantidad: "3", unidadMedidaId: "u1", unidadSimbolo: "mg", modoExpresion: "TOTAL" },
      { drogaId: "d2", drogaNombre: "Lactosa", cantidad: null, unidadMedidaId: "u1", unidadSimbolo: "mg", modoExpresion: "CSP" },
    ]);
  });

  it("falls back to the razón social when the farmacia has no nombre de fantasía", async () => {
    expect((await getRecurrentesCrudos(asTx(fakeTx({ nombreFantasia: null })), TENANT, AHORA)).farmaciaNombre).toBe("San José S.R.L.");
    expect((await getRecurrentesCrudos(asTx(fakeTx({ nombreFantasia: "  " })), TENANT, AHORA)).farmaciaNombre).toBe("San José S.R.L.");
  });
});
