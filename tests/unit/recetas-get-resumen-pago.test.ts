/**
 * Unit tests for `getResumenPagoReceta` (modules/recetas/application/get-resumen-pago-receta.ts).
 * Tests behavior, security boundaries (permisos), on-the-fly costing of unquoted items,
 * fallback for pre-0107 cotizaciones without IVA, missing drug costs, and item ordering.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthorizationError, DomainError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { Decimal } from "@/shared/decimal";
import type { ItemParaResumenPago } from "@/modules/recetas/infrastructure/receta-repository";
import type { CostoCalculado } from "@/modules/precios/domain/calcular-cotizacion";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const FAKE_TX = { __fakeTx: true };
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn(FAKE_TX),
}));

const requireSessionMock = vi.fn();
vi.mock("@/shared/auth/session", () => ({
  requireSession: (...args: unknown[]) => requireSessionMock(...args),
  requireRecentReauth: vi.fn(),
}));

const getItemsParaResumenPagoMock = vi.fn();
vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  getItemsParaResumenPago: (...args: unknown[]) => getItemsParaResumenPagoMock(...args),
}));

const costearItemsAcumuladoMock = vi.fn();
vi.mock("@/modules/precios/application/cotizar-lineas", () => ({
  costearItemsAcumulado: (...args: unknown[]) => costearItemsAcumuladoMock(...args),
}));

const calcularLineasFichaMock = vi.fn();
const resolverFormulaBorradorMock = vi.fn();
vi.mock("@/modules/elaboracion/application/calcular-lineas-ficha", () => ({
  calcularLineasFicha: (...args: unknown[]) => calcularLineasFichaMock(...args),
  resolverFormulaBorrador: (...args: unknown[]) => resolverFormulaBorradorMock(...args),
}));

const { getResumenPagoReceta } = await import("@/modules/recetas/application/get-resumen-pago-receta");

const RECETA_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "99999999-9999-4999-8999-999999999999";

function makeSession(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "user@example.com", nombre: "Juan", apellido: "Pérez" },
    tenantId: TENANT_ID,
    sesionId: "s-1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

function makeItem(overrides: Partial<ItemParaResumenPago> = {}): ItemParaResumenPago {
  return {
    id: "item-1",
    formaFarmaceutica: "CREMA",
    cantidadUnidades: 1,
    fraccionDosisPorUnidad: "1",
    cantidadTotal: null,
    unidadTotalId: null,
    componentes: [],
    ultimaCotizacion: null,
    ultimaFichaLineas: [
      {
        drogaId: "droga-1",
        drogaNombre: "Urea",
        unidadSimbolo: "g",
        unidad: { factorABase: "1", tipoMagnitud: "MASA" },
        cantidadAPesar: "10",
        esEnraseManual: false,
        orden: 1,
      },
    ],
    ...overrides,
  };
}

function makeCostoCalculado(overrides: Partial<CostoCalculado> = {}): CostoCalculado {
  return {
    costoInsumos: new Decimal("20"),
    costoInsumosConIva: new Decimal("24.2"),
    esParcial: false,
    esIncompleta: false,
    drogasSinPrecio: [],
    detalle: {
      lineas: [
        {
          drogaId: "droga-1",
          drogaNombre: "Urea",
          unidadSimbolo: "g",
          orden: 0,
          cantidadRequerida: "10",
          subtotal: "20",
          fuente: "PROVEEDOR",
          esEnraseManual: false,
          faltante: null,
          partidas: [],
        },
      ],
    },
    ...overrides,
  };
}

describe("getResumenPagoReceta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("permisos y visibilidad de costo y precio", () => {
    it("sin cotizaciones.costo.ver -> no hay costo en la respuesta (la propiedad no existe)", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.calcular"]));
      getItemsParaResumenPagoMock.mockResolvedValue([
        makeItem({
          ultimaCotizacion: { costoConIva: "50", precioFinal: "100" },
        }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      expect(res).toHaveProperty("precio");
      expect(res).not.toHaveProperty("costo");
      expect(res!.precio).toEqual({ total: "100", itemsSinCotizar: [] });
    });

    it("sin cotizaciones.calcular ni cotizaciones.ver -> no hay precio en la respuesta (la propiedad no existe)", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver"]));
      getItemsParaResumenPagoMock.mockResolvedValue([
        makeItem({
          ultimaCotizacion: { costoConIva: "50", precioFinal: "100" },
        }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      expect(res).toHaveProperty("costo");
      expect(res).not.toHaveProperty("precio");
      expect(res!.costo).toEqual({ total: "50", avisos: [] });
    });

    it("con cotizaciones.ver (consulta de precios) -> hay precio sin necesidad de cotizaciones.calcular", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.ver"]));
      getItemsParaResumenPagoMock.mockResolvedValue([
        makeItem({
          ultimaCotizacion: { costoConIva: "50", precioFinal: "100" },
        }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      expect(res).toHaveProperty("precio");
      expect(res).not.toHaveProperty("costo");
      expect(res!.precio!.total).toBe("100");
    });

    it("con ambos permisos (cotizaciones.costo.ver y cotizaciones.calcular) -> están tanto costo como precio", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver", "cotizaciones.calcular"]));
      getItemsParaResumenPagoMock.mockResolvedValue([
        makeItem({
          ultimaCotizacion: { costoConIva: "50", precioFinal: "100" },
        }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      expect(res).toHaveProperty("costo");
      expect(res).toHaveProperty("precio");
      expect(res!.costo!.total).toBe("50");
      expect(res!.precio!.total).toBe("100");
    });

    it("sin ninguno de los permisos -> rechaza con AuthorizationError", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["recetas.crear"]));
      getItemsParaResumenPagoMock.mockResolvedValue([makeItem()]);

      await expect(getResumenPagoReceta(RECETA_ID)).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe("costeo con cotización guardada y fallback pre-0107", () => {
    it("usa el costoConIva de la cotización guardada cuando existe", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver", "cotizaciones.calcular"]));
      getItemsParaResumenPagoMock.mockResolvedValue([
        makeItem({
          id: "item-1",
          ultimaCotizacion: { costoConIva: "121", precioFinal: "250" },
        }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      expect(res!.costo!.total).toBe("121");
      expect(res!.precio!.total).toBe("250");
      // No on-the-fly costing was needed
      expect(costearItemsAcumuladoMock).not.toHaveBeenCalled();
    });

    it("suma múltiples cotizaciones guardadas acumulando costos con IVA y precios finales", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver", "cotizaciones.calcular"]));
      getItemsParaResumenPagoMock.mockResolvedValue([
        makeItem({
          id: "item-1",
          ultimaCotizacion: { costoConIva: "100.5", precioFinal: "200" },
        }),
        makeItem({
          id: "item-2",
          ultimaCotizacion: { costoConIva: "49.5", precioFinal: "100" },
        }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      expect(res!.costo!.total).toBe("150");
      expect(res!.precio!.total).toBe("300");
      expect(res!.precio!.itemsSinCotizar).toEqual([]);
    });
  });

  describe("costeo al vuelo de ítems sin cotizar", () => {
    it("un ítem sin cotización se costea en el momento y figura en itemsSinCotizar", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver", "cotizaciones.calcular"]));

      const itemCotizado = makeItem({
        id: "item-1",
        ultimaCotizacion: { costoConIva: "50", precioFinal: "100" },
      });
      const itemSinCotizar = makeItem({
        id: "item-2",
        ultimaCotizacion: null,
        ultimaFichaLineas: [
          {
            drogaId: "droga-2",
            drogaNombre: "Mazindol",
            unidadSimbolo: "g",
            unidad: { factorABase: "1", tipoMagnitud: "MASA" },
            cantidadAPesar: "5",
            esEnraseManual: false,
            orden: 1,
          },
        ],
      });

      getItemsParaResumenPagoMock.mockResolvedValue([itemCotizado, itemSinCotizar]);
      costearItemsAcumuladoMock.mockResolvedValue([
        makeCostoCalculado({
          costoInsumosConIva: new Decimal("35"),
        }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      // Price includes only quoted items; unquoted item is listed by its 1-based index (2)
      expect(res!.precio!.total).toBe("100");
      expect(res!.precio!.itemsSinCotizar).toEqual([2]);
      // Cost includes quoted item (50) + on-the-fly costed item (35) = 85
      expect(res!.costo!.total).toBe("85");
      expect(res!.costo!.avisos).toEqual([]);
      expect(costearItemsAcumuladoMock).toHaveBeenCalledTimes(1);
    });

    it("resuelve la fórmula si el ítem no tiene última ficha técnica guardada", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver"]));

      const itemBorrador = makeItem({
        id: "item-draft",
        ultimaCotizacion: null,
        ultimaFichaLineas: null,
        componentes: [
          {
            drogaId: "droga-1",
            cantidad: "10",
            unidadMedidaId: "u-1",
            modoExpresion: "TOTAL",
            unidadReferenciaId: null,
            drogaAliasId: null,
          },
        ],
      });

      getItemsParaResumenPagoMock.mockResolvedValue([itemBorrador]);
      resolverFormulaBorradorMock.mockResolvedValue({
        item: { formaFarmaceutica: "CREMA" },
        componentes: [],
      });
      calcularLineasFichaMock.mockResolvedValue([
        {
          drogaId: "droga-1",
          drogaNombre: "Urea",
          unidadSimbolo: "g",
          unidadMedida: { factorABase: 1, tipoMagnitud: "MASA" },
          cantidadAPesar: "10",
          esEnraseManual: false,
          orden: 1,
        },
      ]);
      costearItemsAcumuladoMock.mockResolvedValue([
        makeCostoCalculado({
          costoInsumosConIva: new Decimal("40"),
        }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      expect(res!.costo!.total).toBe("40");
      expect(resolverFormulaBorradorMock).toHaveBeenCalledTimes(1);
      expect(calcularLineasFichaMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("drogas sin costo y avisos", () => {
    it("una droga sin costo deja costo.total en null con el aviso correspondiente", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver", "cotizaciones.calcular"]));

      const itemCotizado = makeItem({
        id: "item-1",
        ultimaCotizacion: { costoConIva: "50", precioFinal: "100" },
      });
      const itemSinCosto = makeItem({
        id: "item-2",
        ultimaCotizacion: null,
      });

      getItemsParaResumenPagoMock.mockResolvedValue([itemCotizado, itemSinCosto]);
      costearItemsAcumuladoMock.mockResolvedValue([
        makeCostoCalculado({
          costoInsumosConIva: new Decimal("0"),
          drogasSinPrecio: ["Droga Sin Proveedor"],
        }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      expect(res!.costo!.total).toBeNull();
      expect(res!.costo!.avisos).toEqual([
        "No se puede dar el precio: Droga Sin Proveedor no tiene precio cargado en costos de proveedor.",
      ]);
      // Price of quoted item is still reported
      expect(res!.precio!.total).toBe("100");
      expect(res!.precio!.itemsSinCotizar).toEqual([2]);
    });

    it("error no fatal al resolver líneas del ítem deja costo.total en null con el aviso de dicho ítem", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver"]));

      const itemConError = makeItem({
        id: "item-bad",
        ultimaCotizacion: null,
        ultimaFichaLineas: null,
      });

      getItemsParaResumenPagoMock.mockResolvedValue([itemConError]);
      resolverFormulaBorradorMock.mockRejectedValue(new DomainError("La fracción de dosis por unidad debe ser mayor que 0."));

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      expect(res!.costo!.total).toBeNull();
      expect(res!.costo!.avisos).toEqual([
        "Ítem 1: La fracción de dosis por unidad debe ser mayor que 0.",
      ]);
    });
  });

  describe("orden y numeración de ítems", () => {
    it("los números de ítem siguen estrictamente el orden devuelto por getReceta (1-based)", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver", "cotizaciones.calcular"]));

      // Order: Item 1 (unquoted), Item 2 (quoted), Item 3 (unquoted)
      const items = [
        makeItem({ id: "item-A", ultimaCotizacion: null }),
        makeItem({ id: "item-B", ultimaCotizacion: { costoConIva: "10", precioFinal: "20" } }),
        makeItem({ id: "item-C", ultimaCotizacion: null }),
      ];

      getItemsParaResumenPagoMock.mockResolvedValue(items);
      costearItemsAcumuladoMock.mockResolvedValue([
        makeCostoCalculado({ costoInsumosConIva: new Decimal("5") }),
        makeCostoCalculado({ costoInsumosConIva: new Decimal("15") }),
      ]);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).not.toBeNull();
      // Items 1 and 3 are unquoted in the original order
      expect(res!.precio!.itemsSinCotizar).toEqual([1, 3]);
      expect(res!.precio!.total).toBe("20");
      // Total cost: 10 (quoted item 2) + 5 (item 1) + 15 (item 3) = 30
      expect(res!.costo!.total).toBe("30");
    });
  });

  describe("receta inexistente", () => {
    it("devuelve null cuando la receta no existe para el tenant", async () => {
      requireSessionMock.mockResolvedValue(makeSession(["cotizaciones.costo.ver", "cotizaciones.calcular"]));
      getItemsParaResumenPagoMock.mockResolvedValue(null);

      const res = await getResumenPagoReceta(RECETA_ID);
      expect(res).toBeNull();
    });
  });
});
