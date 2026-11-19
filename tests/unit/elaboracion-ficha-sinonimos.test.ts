import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

const findManyMock = vi.fn();

describe("getSinonimosParaBorrador (modules/elaboracion/infrastructure/ficha-repository)", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("returns an empty Map without querying when ids is empty", async () => {
    const { getSinonimosParaBorrador } = await import("@/modules/elaboracion/infrastructure/ficha-repository");
    const tx = { drogaAlias: { findMany: findManyMock } } as unknown as Prisma.TransactionClient;

    const map = await getSinonimosParaBorrador(tx, "tenant-1", []);

    expect(map.size).toBe(0);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("queries deduplicated ids scoped to tenantId and maps id to texto", async () => {
    const { getSinonimosParaBorrador } = await import("@/modules/elaboracion/infrastructure/ficha-repository");
    findManyMock.mockResolvedValue([
      { id: "alias-1", texto: "Vitamina C" },
      { id: "alias-2", texto: "Ácido Ascórbico USP" },
    ]);
    const tx = { drogaAlias: { findMany: findManyMock } } as unknown as Prisma.TransactionClient;

    const map = await getSinonimosParaBorrador(tx, "tenant-1", ["alias-1", "alias-1", "alias-2"]);

    expect(findManyMock).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", id: { in: ["alias-1", "alias-2"] } },
      select: { id: true, texto: true },
    });
    expect(map.get("alias-1")).toBe("Vitamina C");
    expect(map.get("alias-2")).toBe("Ácido Ascórbico USP");
  });
});

describe("resolverFormulaBorrador -- synonym names on ficha técnica (f4c50a3)", () => {
  it("uses the synonym name when drogaAliasId is provided and falls back to droga.nombre otherwise", async () => {
    vi.doMock("@/modules/elaboracion/infrastructure/ficha-repository", () => ({
      getUnidadesParaBorrador: vi.fn(async () =>
        new Map([
          ["u-mg", { vigente: true, ref: { id: "u-mg", tipoMagnitud: "MASA", factorABase: "0.001", simbolo: "mg" } }],
        ]),
      ),
      getDrogasParaBorrador: vi.fn(async () =>
        new Map([
          ["d-1", { nombre: "Ácido ascórbico", vigente: true }],
          ["d-2", { nombre: "Lactosa", vigente: true }],
        ]),
      ),
      getSinonimosParaBorrador: vi.fn(async (_tx: unknown, _tenantId: string, ids: readonly string[]) => {
        expect(ids).toEqual(["alias-1"]);
        return new Map([["alias-1", "Vitamina C"]]);
      }),
      getParametrosPesaje: vi.fn(),
      getUnidadesBase: vi.fn(),
    }));

    vi.resetModules();
    const { resolverFormulaBorrador } = await import("@/modules/elaboracion/application/calcular-lineas-ficha");

    const { componentes } = await resolverFormulaBorrador(
      {} as Prisma.TransactionClient,
      "tenant-1",
      {
        formaFarmaceutica: "CAPSULA",
        cantidadUnidades: 30,
        fraccionDosisPorUnidad: "1",
        cantidadTotal: null,
        unidadTotalId: null,
        componentes: [
          { drogaId: "d-1", drogaAliasId: "alias-1", cantidad: "500", unidadMedidaId: "u-mg", modoExpresion: "POR_DOSIS" },
          { drogaId: "d-2", drogaAliasId: null, cantidad: null, unidadMedidaId: "u-mg", modoExpresion: "CSP" },
        ],
      },
    );

    expect(componentes.map((c) => c.drogaNombre)).toEqual(["Vitamina C", "Lactosa"]);
    vi.doUnmock("@/modules/elaboracion/infrastructure/ficha-repository");
    vi.resetModules();
  });
});
