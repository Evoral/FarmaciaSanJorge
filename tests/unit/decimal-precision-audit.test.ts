/**
 * P3-08 regression tests: Decimal arithmetic vs Number() precision loss (audit P3-08).
 *
 * Audit finding P3-08:
 * - `droga-repository.ts#listDrogas`: the "bajo mínimo" filter must use `dec(disponible).lessThan(dec(stockMinimo))`
 *   instead of `Number()`, preventing false negatives for large quantities or high-precision decimals
 *   where IEEE-754 binary64 loses precision.
 * - `presupuesto.ts#esDecimalPositivo`: validates positive decimal inputs using `dec()` without converting
 *   to `Number()`.
 */
import { describe, it, expect, vi } from "vitest";
import { dec } from "@/shared/decimal";
import { itemsListosParaPresupuesto } from "@/modules/recetas/domain/presupuesto";
import { listDrogas } from "@/modules/drogas/infrastructure/droga-repository";

describe("P3-08: dec() arithmetic prevents Number() precision loss", () => {
  it("proves Number() loses precision on values above MAX_SAFE_INTEGER whereas dec() preserves it", () => {
    const valA = "9007199254740992";
    const valB = "9007199254740993";

    // Standard JavaScript Number() fails this check because 2^53 and 2^53 + 1 round to the same float:
    expect(Number(valA) < Number(valB)).toBe(false);

    // dec() correctly identifies that valA < valB:
    expect(dec(valA).lessThan(dec(valB))).toBe(true);
  });

  it("listDrogas with bajoMinimo: true correctly identifies stock under minimum when Number() would fail", async () => {
    const TENANT_ID = "00000000-0000-4000-a000-000000000001";
    const DROGA_ID = "11111111-1111-4111-a111-111111111111";

    const stockDisponible = "9007199254740992";
    const stockMinimo = "9007199254740993";

    const fakeTx = {
      $queryRaw: vi.fn(async () => [
        { droga_id: DROGA_ID, stock_disponible: stockDisponible },
      ]),
      droga: {
        findMany: vi.fn(async () => [
          {
            id: DROGA_ID,
            nombre: "Droga Test Decimal",
            unidadBaseId: "u-1",
            esControlada: false,
            tipoControl: "NINGUNO",
            clase: "DROGA",
            stockMinimo: { toString: () => stockMinimo },
            fechaBaja: null,
            motivoBaja: null,
            unidadBase: { simbolo: "g" },
          },
        ]),
      },
      drogaAlias: {
        findMany: vi.fn(async () => []),
      },
    } as never;

    const result = await listDrogas(fakeTx, {
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 10,
      bajoMinimo: true,
    });

    // With Number(), this list would be empty (0 items). With dec(), it has 1 item.
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(DROGA_ID);
    expect(result.items[0].stockDisponible).toBe(stockDisponible);
    expect(result.items[0].stockMinimo).toBe(stockMinimo);
  });

  it("itemsListosParaPresupuesto accepts valid high-precision decimal quantities", () => {
    const itemNormal = {
      cantidadUnidades: 30,
      fraccionDosisPorUnidad: "1",
      cantidadTotal: null,
      unidadTotalId: null,
      componentes: [
        {
          drogaId: "d-1",
          cantidad: "9007199254740993", // large integer beyond MAX_SAFE_INTEGER
          unidadMedidaId: "u-1",
          modoExpresion: "POR_DOSIS" as const,
        },
      ],
    };

    expect(itemsListosParaPresupuesto([itemNormal])).toBe(true);

    const itemMicro = {
      cantidadUnidades: 10,
      fraccionDosisPorUnidad: "0,0000000000000001",
      cantidadTotal: "0,000000000000001",
      unidadTotalId: "u-tot",
      componentes: [
        {
          drogaId: "d-2",
          cantidad: "0,0000000000000005",
          unidadMedidaId: "u-1",
          modoExpresion: "TOTAL" as const,
        },
      ],
    };

    expect(itemsListosParaPresupuesto([itemMicro])).toBe(true);

    const itemCero = {
      cantidadUnidades: 10,
      fraccionDosisPorUnidad: "1",
      cantidadTotal: null,
      unidadTotalId: null,
      componentes: [
        {
          drogaId: "d-3",
          cantidad: "0", // zero is not positive
          unidadMedidaId: "u-1",
          modoExpresion: "TOTAL" as const,
        },
      ],
    };

    expect(itemsListosParaPresupuesto([itemCero])).toBe(false);
  });
});
