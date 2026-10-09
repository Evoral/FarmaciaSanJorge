/**
 * /preparaciones list: tab/filter parsing and links
 * (modules/preparaciones/domain/listado.ts), the etiqueta state, the
 * server-side filters of the list query (repository, fake tx), the
 * Pendientes query's mapping (its rule and order run in SQL:
 * tests/db/preparaciones-pendientes.test.ts), and the dd/mm/aaaa hh:mm format.
 */
import { describe, it, expect, vi } from "vitest";
import { PESTANAS_PREPARACIONES, estadoEtiqueta, hrefPreparaciones, parsearFiltrosPreparaciones } from "@/modules/preparaciones/domain/listado";
import {
  listComponentesDePendientes,
  listComponentesDePendientesSql,
  listRecetasPendientes,
  listRecetasPendientesSql,
  listPreparaciones,
} from "@/modules/preparaciones/infrastructure/preparacion-repository";
import { formatFechaHora } from "@/shared/format/fecha";

describe("parsearFiltrosPreparaciones", () => {
  it("defaults to the Pendientes tab, page 1, no filters", () => {
    expect(parsearFiltrosPreparaciones({})).toEqual({ estado: "PENDIENTE", numero: undefined, desde: undefined, hasta: undefined, sinEtiquetaImpresa: false, page: 1 });
  });

  it("reads every tab, Pendientes first", () => {
    expect(PESTANAS_PREPARACIONES.map((p) => [p.estado, p.titulo])).toEqual([
      ["PENDIENTE", "Pendientes"],
      ["INICIADA", "En curso"],
      ["CONFIRMADA", "Confirmadas"],
      ["DESCARTADA", "Descartadas"],
    ]);
    for (const { estado } of PESTANAS_PREPARACIONES) {
      expect(parsearFiltrosPreparaciones({ estado }).estado).toBe(estado);
    }
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
    expect(parsearFiltrosPreparaciones({ estado: "OTRO", page: "-2", numero: "abc" })).toMatchObject({ estado: "PENDIENTE", page: 1, numero: undefined });
  });

  it("'sin etiqueta impresa' only applies on Confirmadas", () => {
    expect(parsearFiltrosPreparaciones({ estado: "DESCARTADA", sinEtiqueta: "1" }).sinEtiquetaImpresa).toBe(false);
    expect(parsearFiltrosPreparaciones({ sinEtiqueta: "1" }).sinEtiquetaImpresa).toBe(false);
  });
});

describe("hrefPreparaciones", () => {
  const base = parsearFiltrosPreparaciones({ estado: "CONFIRMADA", numero: "12", desde: "2026-09-01", sinEtiqueta: "1", page: "2" });

  it("page links keep every filter", () => {
    expect(hrefPreparaciones(base, { page: 3 })).toBe("/preparaciones?estado=CONFIRMADA&numero=12&desde=2026-09-01&sinEtiqueta=1&page=3");
  });

  it("switching tab keeps número/fechas, resets the page and drops the Confirmadas-only switch", () => {
    expect(hrefPreparaciones(base, { estado: "INICIADA" })).toBe("/preparaciones?estado=INICIADA&numero=12&desde=2026-09-01");
    expect(hrefPreparaciones(base, { estado: "PENDIENTE" })).toBe("/preparaciones?numero=12&desde=2026-09-01");
  });

  it("omits the estado only for the default tab (Pendientes)", () => {
    const sinFiltros = parsearFiltrosPreparaciones({});
    expect(hrefPreparaciones(sinFiltros)).toBe("/preparaciones");
    expect(hrefPreparaciones(sinFiltros, { estado: "PENDIENTE" })).toBe("/preparaciones");
    expect(hrefPreparaciones(sinFiltros, { estado: "INICIADA" })).toBe("/preparaciones?estado=INICIADA");
    expect(hrefPreparaciones(sinFiltros, { estado: "DESCARTADA" })).toBe("/preparaciones?estado=DESCARTADA");
  });

  it("round-trips every tab and its filters through the URL", () => {
    for (const { estado } of PESTANAS_PREPARACIONES) {
      const filtros = parsearFiltrosPreparaciones({ estado, numero: "7", desde: "2026-09-01", hasta: "2026-09-30", sinEtiqueta: "1", page: "4" });
      const href = hrefPreparaciones(filtros);
      const params = Object.fromEntries(new URL(href, "http://x").searchParams);
      expect(parsearFiltrosPreparaciones(params)).toEqual(filtros);
    }
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
        iniciadaPor: { nombre: "Laura", apellido: "Gómez" },
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

describe("listRecetasPendientes (repository): one SQL statement, total + page", () => {
  const vacia = { item_receta_id: null, item_descripcion: null, forma_farmaceutica: null, cantidad_unidades: null, cantidad_total: null, unidad_total_simbolo: null, posologia: null, duracion_tratamiento_dias: null, posicion: null, total_items: null, ficha_tecnica_id: null, receta_id: null, receta_numero_interno: null, receta_fecha_ingreso: null, paciente_nombre: null, paciente_apellido: null };

  it("maps each pending receta", async () => {
    const ingreso = new Date("2026-09-10T12:00:00Z");
    const queryRaw = vi.fn(async (...args: unknown[]) => {
      void args;
      return [
        { total: 2, zona_horaria: "America/Argentina/Mendoza", receta_id: "r1", receta_numero_interno: "12", receta_fecha_ingreso: ingreso, paciente_nombre: "Ana", paciente_apellido: "Suárez" },
        { total: 2, zona_horaria: "America/Argentina/Mendoza", receta_id: "r2", receta_numero_interno: "13", receta_fecha_ingreso: ingreso, paciente_nombre: "Luis", paciente_apellido: "Pérez" },
      ];
    });
    const result = await listRecetasPendientes({ $queryRaw: queryRaw } as never, { tenantId: "t1", numeroInterno: "12", page: 1, pageSize: 20 });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(2);
    expect(result.zonaHoraria).toBe("America/Argentina/Mendoza");
    expect(result.items).toEqual([
      { recetaId: "r1", recetaNumeroInterno: "12", recetaFechaIngreso: ingreso, pacienteNombre: "Ana", pacienteApellido: "Suárez" },
      { recetaId: "r2", recetaNumeroInterno: "13", recetaFechaIngreso: ingreso, pacienteNombre: "Luis", pacienteApellido: "Pérez" },
    ]);
  });

  it("an empty page still reports the total", async () => {
    const queryRaw = vi.fn(async () => [{ total: 3, zona_horaria: "UTC", ...vacia }]);
    const result = await listRecetasPendientes({ $queryRaw: queryRaw } as never, { tenantId: "t1", page: 9, pageSize: 20 });
    expect(result).toEqual({ items: [], total: 3, zonaHoraria: "UTC" });
  });

  it("orders oldest first: ingreso, receta Nº, then the ítem's position", () => {
    const sql = listRecetasPendientesSql({ tenantId: "t1", page: 1, pageSize: 20 });
    expect(sql.sql).toMatch(/ORDER BY fecha_ingreso ASC, numero_interno ASC/);
  });
});

describe("listComponentesDePendientes (repository): one batched read for the page", () => {
  it("groups the componentes by ítem, in the statement's order", async () => {
    const queryRaw = vi.fn(async (...args: unknown[]) => {
      void args;
      return [
        { item_receta_id: "i1", id: "c1", droga_nombre: "Urea", cantidad: "10", unidad_medida_simbolo: "%", modo_expresion: "POR_DOSIS", es_principio_activo: true },
        { item_receta_id: "i1", id: "c2", droga_nombre: "Base", cantidad: null, unidad_medida_simbolo: "g", modo_expresion: "CSP", es_principio_activo: false },
        { item_receta_id: "i2", id: "c3", droga_nombre: "Gel base", cantidad: "30", unidad_medida_simbolo: "g", modo_expresion: "TOTAL", es_principio_activo: false },
      ];
    });
    const result = await listComponentesDePendientes({ $queryRaw: queryRaw } as never, "t1", ["i1", "i2", "i3"]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.get("i1")).toEqual([
      { id: "c1", drogaNombre: "Urea", cantidad: "10", unidadMedidaSimbolo: "%", modoExpresion: "POR_DOSIS", esPrincipioActivo: true },
      { id: "c2", drogaNombre: "Base", cantidad: null, unidadMedidaSimbolo: "g", modoExpresion: "CSP", esPrincipioActivo: false },
    ]);
    expect(result.get("i2")).toHaveLength(1);
    expect(result.has("i3")).toBe(false);
  });

  it("an empty page runs no query", async () => {
    const queryRaw = vi.fn();
    expect((await listComponentesDePendientes({ $queryRaw: queryRaw } as never, "t1", [])).size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("is tenant-scoped and ordered by ítem, then orden", () => {
    const sql = listComponentesDePendientesSql("t1", ["i1"]);
    expect(sql.text).toMatch(/c\.tenant_id = \$1::uuid AND c\.item_receta_id = ANY\(\$2::uuid\[\]\)/);
    
    expect(sql.values).toEqual(["t1", ["i1"]]);
  });
});

describe("formatFechaHora", () => {
  it("dd/mm/aaaa hh:mm in the farmacia's zona horaria", () => {
    expect(formatFechaHora(new Date("2026-09-10T02:05:00Z"), "America/Argentina/Mendoza")).toBe("09/09/2026 23:05");
  });
});

