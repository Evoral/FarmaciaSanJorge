/**
 * modules/recetas/domain/anulacion.ts: the decision the receta detail page
 * renders and `recetas.anular` enforces (direct anulación vs. the libro
 * recetario, D2 REVISED -- docs/specs/libro-recetario-y-contralor.md §1).
 */
import { describe, it, expect } from "vitest";
import { decidirAnulacion } from "@/modules/recetas/domain/anulacion";

const I1 = "item-1";
const I2 = "item-2";

describe("decidirAnulacion", () => {
  it("terminal recetas cannot be anulled at all", () => {
    expect(decidirAnulacion({ estado: "ENTREGADA", itemIds: [I1], asientosEnEfecto: [], itemsConPreparacionIniciada: [] })).toEqual({ tipo: "terminal" });
  });

  it("allowed with no preparación, or when every asiento is sin efecto", () => {
    expect(decidirAnulacion({ estado: "PENDIENTE_PREPARACION", itemIds: [I1, I2], asientosEnEfecto: [], itemsConPreparacionIniciada: [] })).toEqual({
      tipo: "permitida",
    });
  });

  it("blocked by the asientos still in effect, each with its item number (detail-page order)", () => {
    expect(
      decidirAnulacion({
        estado: "PREPARADA",
        itemIds: [I1, I2],
        asientosEnEfecto: [
          { itemRecetaId: I2, asientoId: "a-2", numeroCorrelativo: "31" },
          { itemRecetaId: I1, asientoId: "a-1", numeroCorrelativo: "30" },
        ],
        itemsConPreparacionIniciada: [],
      }),
    ).toEqual({
      tipo: "bloqueada-libro",
      asientos: [
        { asientoId: "a-2", numeroCorrelativo: "31", item: 2 },
        { asientoId: "a-1", numeroCorrelativo: "30", item: 1 },
      ],
    });
  });

  it("blocked by a preparación still INICIADA (the libro block wins when both apply)", () => {
    expect(decidirAnulacion({ estado: "EN_PREPARACION", itemIds: [I1, I2], asientosEnEfecto: [], itemsConPreparacionIniciada: [I2] })).toEqual({
      tipo: "bloqueada-preparacion",
      item: 2,
    });
    expect(
      decidirAnulacion({
        estado: "EN_PREPARACION",
        itemIds: [I1, I2],
        asientosEnEfecto: [{ itemRecetaId: I1, asientoId: "a-1", numeroCorrelativo: "30" }],
        itemsConPreparacionIniciada: [I2],
      }).tipo,
    ).toBe("bloqueada-libro");
  });
});
