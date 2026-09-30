/**
 * /recetas list: the per-row "Editar" rule computed in ONE extra query for
 * the whole page (no N+1), the tenant's zona horaria for "Ingreso", the
 * dd/mm/aaaa format, and the post-create redirect URL (codes only).
 */
import { describe, it, expect, vi } from "vitest";
import { listRecetas } from "@/modules/recetas/infrastructure/receta-repository";
import { formatFecha } from "@/shared/format/fecha";
import { urlTrasEditar, urlTrasRegistrar } from "@/modules/recetas/domain/avisos-generacion";

function fila(id: string, estado: string) {
  return {
    id,
    numeroInterno: BigInt(1),
    fechaPrescripcion: new Date("2026-09-01T00:00:00Z"),
    fechaIngreso: new Date("2026-09-30T02:30:00Z"),
    origen: "PRESENCIAL",
    estado,
    recetaFisicaRecibida: false,
    paciente: { nombre: "Ana", apellido: "Suárez" },
    medico: { nombre: "Martín", apellido: "Ríos" },
  };
}

describe("listRecetas (repository)", () => {
  it("marks as editable only PENDIENTE_PREPARACION recetas without a ficha with preparación, in one query", async () => {
    const queryRaw = vi.fn(async (...args: unknown[]) => {
      void args;
      return [{ receta_id: "r2" }];
    });
    const tx = {
      receta: {
        count: vi.fn(async () => 3),
        findMany: vi.fn(async () => [fila("r1", "PENDIENTE_PREPARACION"), fila("r2", "PENDIENTE_PREPARACION"), fila("r3", "PREPARADA")]),
      },
      tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
      itemReceta: {
        findMany: vi.fn(async () => [
          // r1: item 1 already confirmed (on its first ficha), item 2 has an INICIADA preparación on its latest ficha.
          { id: "i1", recetaId: "r1", fichas: [{ id: "f1b", preparaciones: [] }, { id: "f1a", preparaciones: [{ id: "p1", estado: "CONFIRMADA" }] }] },
          { id: "i2", recetaId: "r1", fichas: [{ id: "f2", preparaciones: [{ id: "p2", estado: "INICIADA" }] }] },
          // r3: one item without ficha.
          { id: "i3", recetaId: "r3", fichas: [] },
        ]),
      },
      $queryRaw: queryRaw,
    };

    const result = await listRecetas(tx as never, { tenantId: "t1", page: 1, pageSize: 20 });

    expect(result.items.map((r) => [r.id, r.editable])).toEqual([
      ["r1", true],
      ["r2", false],
      ["r3", false],
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    // Only the PENDIENTE_PREPARACION ids are checked.
    expect(queryRaw.mock.calls[0]).toContainEqual(["r1", "r2"]);
    expect(result.zonaHoraria).toBe("America/Argentina/Mendoza");
  });

  it("hands each receta its items for the Preparar action (latest ficha, INICIADA / CONFIRMADA on any version), in one query", async () => {
    const itemFindMany = vi.fn(async () => [
      { id: "i1", recetaId: "r1", fichas: [{ id: "f1b", preparaciones: [] }, { id: "f1a", preparaciones: [{ id: "p1", estado: "CONFIRMADA" }] }] },
      { id: "i2", recetaId: "r1", fichas: [{ id: "f2", preparaciones: [{ id: "p2", estado: "INICIADA" }] }] },
    ]);
    const tx = {
      receta: { count: vi.fn(async () => 2), findMany: vi.fn(async () => [fila("r1", "EN_PREPARACION"), fila("r9", "ENTREGADA")]) },
      tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "UTC" })) },
      itemReceta: { findMany: itemFindMany },
      $queryRaw: vi.fn(async () => []),
    };
    const result = await listRecetas(tx as never, { tenantId: "t1", page: 1, pageSize: 20 });
    expect(itemFindMany).toHaveBeenCalledTimes(1);
    // Terminal recetas are not even looked up.
    expect(itemFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "t1", recetaId: { in: ["r1"] } } }));
    expect(result.items[0]!.itemsParaPreparar).toEqual([
      { itemRecetaId: "i1", fichaVigenteId: "f1b", preparacionIniciadaId: null, tieneConfirmada: true },
      { itemRecetaId: "i2", fichaVigenteId: "f2", preparacionIniciadaId: "p2", tieneConfirmada: false },
    ]);
    expect(result.items[1]!.itemsParaPreparar).toEqual([]);
  });
});

describe("formatFecha", () => {
  it("shows dd/mm/aaaa; a date column in UTC, a timestamp in the farmacia's zone", () => {
    expect(formatFecha(new Date("2026-03-05T00:00:00Z"))).toBe("05/03/2026");
    // 02:30 UTC on the 30th is still the 29th in Mendoza (UTC-3).
    expect(formatFecha(new Date("2026-09-30T02:30:00Z"), "America/Argentina/Mendoza")).toBe("29/09/2026");
  });
});

describe("redirect after saving a receta", () => {
  it("creating lands on the list with the receta id and the notice codes; editing on the receta", () => {
    const avisos = [{ tipo: "ficha" as const, item: 1, codigo: "V5" as const }];
    expect(urlTrasRegistrar("r1", avisos)).toBe("/recetas?registrada=r1&aviso=f1-V5");
    expect(urlTrasRegistrar("r1", [])).toBe("/recetas?registrada=r1");
    expect(urlTrasEditar("r1", avisos)).toBe("/recetas/r1?aviso=f1-V5");
    expect(urlTrasEditar("r1", [])).toBe("/recetas/r1");
  });
});
