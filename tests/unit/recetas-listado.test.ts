/**
 * /recetas list: the per-row "Editar" rule computed in ONE extra query for
 * the whole page (no N+1), the tenant's zona horaria for "Ingreso", the
 * dd/mm/aaaa format, and the post-create redirect URL (codes only).
 */
import { describe, it, expect, vi } from "vitest";
import { listRecetas } from "@/modules/recetas/infrastructure/receta-repository";
import { formatFecha } from "@/shared/format/fecha";
import { urlTrasEditar, urlTrasRegistrar } from "@/modules/recetas/domain/avisos-generacion";

const buscarPersonasPorNombreMock = vi.fn(async (_tx: unknown, tabla: string, _tenantId: string, _busqueda: string) => {
  if (tabla === "paciente") return ["pac-1", "pac-2"];
  if (tabla === "medico") return ["med-1"];
  return [];
});

vi.mock("@/shared/db/busqueda-persona", () => ({
  buscarPersonasPorNombre: (...args: unknown[]) =>
    buscarPersonasPorNombreMock(...(args as [unknown, string, string, string])),
}));

function fila(id: string, estado: string) {
  return {
    id,
    numeroInterno: BigInt(1),
    fechaPrescripcion: new Date("2026-09-01T00:00:00Z"),
    fechaIngreso: new Date("2026-09-30T02:30:00Z"),
    origen: "PRESENCIAL",
    estado,
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

  it("builds where.AND with trimmed paciente filter matching by name IDs, DNI and CUIL", async () => {
    buscarPersonasPorNombreMock.mockClear();
    const countMock = vi.fn(async () => 2);
    const findManyMock = vi.fn(async () => [fila("r1", "PREPARADA"), fila("r2", "PREPARADA")]);
    const tx = {
      receta: { count: countMock, findMany: findManyMock },
      tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
      $queryRaw: vi.fn(async () => []),
    };

    await listRecetas(tx as never, { tenantId: "t1", page: 1, pageSize: 2, paciente: "  Juan Perez  " });

    expect(buscarPersonasPorNombreMock).toHaveBeenCalledWith(tx, "paciente", "t1", "Juan Perez");
    const expectedWhere = {
      tenantId: "t1",
      AND: [
        {
          OR: [
            { pacienteId: { in: ["pac-1", "pac-2"] } },
            { paciente: { dni: { contains: "Juan Perez" } } },
            { paciente: { cuil: { contains: "Juan Perez" } } },
          ],
        },
      ],
    };
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
    expect(countMock).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it("builds where.AND with trimmed médico filter matching by name IDs and matrícula (insensitive)", async () => {
    buscarPersonasPorNombreMock.mockClear();
    const countMock = vi.fn(async () => 2);
    const findManyMock = vi.fn(async () => [fila("r1", "PREPARADA"), fila("r2", "PREPARADA")]);
    const tx = {
      receta: { count: countMock, findMany: findManyMock },
      tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
      $queryRaw: vi.fn(async () => []),
    };

    await listRecetas(tx as never, { tenantId: "t1", page: 1, pageSize: 2, medico: "  Dra. Ríos  " });

    expect(buscarPersonasPorNombreMock).toHaveBeenCalledWith(tx, "medico", "t1", "Dra. Ríos");
    const expectedWhere = {
      tenantId: "t1",
      AND: [
        {
          OR: [
            { medicoId: { in: ["med-1"] } },
            { medico: { matricula: { contains: "Dra. Ríos", mode: "insensitive" } } },
          ],
        },
      ],
    };
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
    expect(countMock).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it("combines both paciente and médico in where.AND when both filters are provided", async () => {
    buscarPersonasPorNombreMock.mockClear();
    const countMock = vi.fn(async () => 2);
    const findManyMock = vi.fn(async () => [fila("r1", "PREPARADA"), fila("r2", "PREPARADA")]);
    const tx = {
      receta: { count: countMock, findMany: findManyMock },
      tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
      $queryRaw: vi.fn(async () => []),
    };

    await listRecetas(tx as never, { tenantId: "t1", page: 1, pageSize: 2, paciente: "  Juan  ", medico: "  Ríos  " });

    expect(buscarPersonasPorNombreMock).toHaveBeenCalledWith(tx, "paciente", "t1", "Juan");
    expect(buscarPersonasPorNombreMock).toHaveBeenCalledWith(tx, "medico", "t1", "Ríos");
    const expectedWhere = {
      tenantId: "t1",
      AND: [
        {
          OR: [
            { pacienteId: { in: ["pac-1", "pac-2"] } },
            { paciente: { dni: { contains: "Juan" } } },
            { paciente: { cuil: { contains: "Juan" } } },
          ],
        },
        {
          OR: [
            { medicoId: { in: ["med-1"] } },
            { medico: { matricula: { contains: "Ríos", mode: "insensitive" } } },
          ],
        },
      ],
    };
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
    expect(countMock).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it("omits AND key from where when paciente/médico are empty or only whitespace, or omitted", async () => {
    buscarPersonasPorNombreMock.mockClear();
    const countMock = vi.fn(async () => 2);
    const findManyMock = vi.fn(async () => [fila("r1", "PREPARADA"), fila("r2", "PREPARADA")]);
    const tx = {
      receta: { count: countMock, findMany: findManyMock },
      tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
      $queryRaw: vi.fn(async () => []),
    };

    await listRecetas(tx as never, { tenantId: "t1", page: 1, pageSize: 2, paciente: "   ", medico: "" });
    expect(buscarPersonasPorNombreMock).not.toHaveBeenCalled();
    const whereWithWhitespace = (findManyMock.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect("AND" in whereWithWhitespace).toBe(false);
    expect(whereWithWhitespace).toEqual({ tenantId: "t1" });

    findManyMock.mockClear();
    countMock.mockClear();
    await listRecetas(tx as never, { tenantId: "t1", page: 1, pageSize: 2 });
    const whereWithoutFilters = (findManyMock.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect("AND" in whereWithoutFilters).toBe(false);
    expect(whereWithoutFilters).toEqual({ tenantId: "t1" });
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
