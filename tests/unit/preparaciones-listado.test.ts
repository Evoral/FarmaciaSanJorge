/**
 * /preparaciones list: tab/filter parsing and links
 * (modules/preparaciones/domain/listado.ts), the etiqueta state, the
 * server-side filters of the list query (repository, fake tx), and the
 * dd/mm/aaaa hh:mm format.
 */
import { describe, it, expect, vi } from "vitest";
import { estadoEtiqueta, hrefPreparaciones, parsearFiltrosPreparaciones } from "@/modules/preparaciones/domain/listado";
import { listPreparaciones } from "@/modules/preparaciones/infrastructure/preparacion-repository";
import { formatFechaHora } from "@/shared/format/fecha";

describe("parsearFiltrosPreparaciones", () => {
  it("defaults to the En curso tab, page 1, no filters", () => {
    expect(parsearFiltrosPreparaciones({})).toEqual({ estado: "INICIADA", numero: undefined, desde: undefined, hasta: undefined, sinEtiquetaImpresa: false, page: 1 });
  });

  it("reads the tab, number (digits only), dates and page; drops anything malformed", () => {
    expect(parsearFiltrosPreparaciones({ estado: "CONFIRMADA", numero: "Nº 1.234", desde: "2026-09-01", hasta: "30/09/2026", page: "3", sinEtiqueta: "1" })).toEqual({
      estado: "CONFIRMADA",
      numero: "1234",
      desde: "2026-09-01",
      hasta: undefined,
      sinEtiquetaImpresa: true,
      page: 3,
    });
    expect(parsearFiltrosPreparaciones({ estado: "OTRO", page: "-2", numero: "abc" })).toMatchObject({ estado: "INICIADA", page: 1, numero: undefined });
  });

  it("'sin etiqueta impresa' only applies on Confirmadas", () => {
    expect(parsearFiltrosPreparaciones({ estado: "DESCARTADA", sinEtiqueta: "1" }).sinEtiquetaImpresa).toBe(false);
  });
});

describe("hrefPreparaciones", () => {
  const base = parsearFiltrosPreparaciones({ estado: "CONFIRMADA", numero: "12", desde: "2026-09-01", sinEtiqueta: "1", page: "2" });

  it("page links keep every filter", () => {
    expect(hrefPreparaciones(base, { page: 3 })).toBe("/preparaciones?estado=CONFIRMADA&numero=12&desde=2026-09-01&sinEtiqueta=1&page=3");
  });

  it("switching tab keeps número/fechas, resets the page and drops the Confirmadas-only switch", () => {
    expect(hrefPreparaciones(base, { estado: "INICIADA" })).toBe("/preparaciones?numero=12&desde=2026-09-01");
    expect(hrefPreparaciones(parsearFiltrosPreparaciones({}), { estado: "INICIADA" })).toBe("/preparaciones");
  });
});

describe("estadoEtiqueta", () => {
  it("Pendiente / Generada / Impresa", () => {
    expect(estadoEtiqueta(null)).toBe("PENDIENTE");
    expect(estadoEtiqueta({ impresa: false })).toBe("GENERADA");
    expect(estadoEtiqueta({ impresa: true })).toBe("IMPRESA");
  });
});

function fakeTx() {
  const findMany = vi.fn(async (...args: unknown[]) => {
    void args;
    return [
      {
        id: "p1",
        estado: "CONFIRMADA",
        fichaTecnicaId: "f1",
        iniciadaEn: new Date("2026-09-10T12:00:00Z"),
        confirmadaEn: new Date("2026-09-10T13:00:00Z"),
        etiqueta: { impresa: false },
        fichaTecnica: { itemReceta: { descripcion: null, formaFarmaceutica: "CREMA", receta: { id: "r1", numeroInterno: BigInt(12), paciente: { nombre: "Ana", apellido: "Suárez" } } } },
      },
    ];
  });
  const count = vi.fn(async (...args: unknown[]) => {
    void args;
    return 1;
  });
  return {
    tx: { preparacion: { findMany, count }, tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) } },
    findMany,
    count,
  };
}

describe("listPreparaciones (repository): filters in the query", () => {
  it("número, fechas (tenant's calendar days) and 'sin etiqueta impresa' become the WHERE; the etiqueta comes in the same query", async () => {
    const { tx, findMany } = fakeTx();
    const result = await listPreparaciones(tx as never, {
      tenantId: "t1",
      estado: "CONFIRMADA",
      numeroInterno: "12",
      desde: "2026-09-01",
      hasta: "2026-09-30",
      sinEtiquetaImpresa: true,
      page: 1,
      pageSize: 20,
    });
    const args = findMany.mock.calls[0]![0] as { where: { AND: unknown[] }; select: Record<string, unknown> };
    expect(args.where.AND).toEqual([
      {
        tenantId: "t1",
        fichaTecnica: { itemReceta: { receta: { numeroInterno: BigInt(12) } } },
        // 00:00 in Mendoza (UTC-3) = 03:00 UTC; "hasta" is exclusive at the next day's start.
        iniciadaEn: { gte: new Date("2026-09-01T03:00:00.000Z"), lt: new Date("2026-10-01T03:00:00.000Z") },
      },
      { estado: "CONFIRMADA" },
      { OR: [{ etiqueta: { is: null } }, { etiqueta: { is: { impresa: false } } }] },
    ]);
    expect(args.select.etiqueta).toEqual({ select: { impresa: true } });
    expect(result.items[0]).toMatchObject({ recetaId: "r1", recetaNumeroInterno: "12", etiqueta: { impresa: false } });
    expect(result.zonaHoraria).toBe("America/Argentina/Mendoza");
  });

  it("the switch is ignored outside Confirmadas", async () => {
    const { tx, findMany } = fakeTx();
    await listPreparaciones(tx as never, { tenantId: "t1", estado: "INICIADA", sinEtiquetaImpresa: true, page: 1, pageSize: 20 });
    expect((findMany.mock.calls[0]![0] as { where: { AND: unknown[] } }).where.AND).toEqual([{ tenantId: "t1" }, { estado: "INICIADA" }]);
  });
});

describe("formatFechaHora", () => {
  it("dd/mm/aaaa hh:mm in the farmacia's zona horaria", () => {
    expect(formatFechaHora(new Date("2026-09-10T02:05:00Z"), "America/Argentina/Mendoza")).toBe("09/09/2026 23:05");
  });
});
