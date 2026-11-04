import { describe, it, expect, vi } from "vitest";
import { getLineasParaPreparacion } from "@/modules/preparaciones/infrastructure/preparacion-repository";
import { dec } from "@/shared/decimal";

describe("getLineasParaPreparacion sugerirDilucion", () => {
  it("selects droga.sugerirDilucion and maps it to the returned linea", async () => {
    const fakeRow = {
      id: "linea-1",
      drogaId: "droga-1",
      drogaNombre: "Clonazepam",
      cantidadAPesar: dec("0.005"),
      unidadMedidaId: "u-mg",
      esEnraseManual: false,
      orden: 1,
      unidadMedida: {
        simbolo: "mg",
        factorABase: dec("0.001"),
        tipoMagnitud: "MASA",
      },
      droga: {
        sugerirDilucion: true,
        unidadBase: {
          id: "u-mg",
          simbolo: "mg",
          factorABase: dec("0.001"),
          tipoMagnitud: "MASA",
        },
      },
    };

    const findManyMock = vi.fn().mockResolvedValue([fakeRow]);
    const fakeTx = {
      lineaPesaje: {
        findMany: findManyMock,
      },
    };

    const lineas = await getLineasParaPreparacion(
      fakeTx as never,
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-4222-a222-222222222222",
    );

    expect(lineas).toHaveLength(1);
    expect(lineas[0].sugerirDilucion).toBe(true);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          droga: expect.objectContaining({
            select: expect.objectContaining({
              sugerirDilucion: true,
            }),
          }),
        }),
      }),
    );
  });
});
