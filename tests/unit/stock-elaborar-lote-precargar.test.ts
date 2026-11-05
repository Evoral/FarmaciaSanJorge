import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ElaborarLoteForm } from "@/modules/stock/ui/elaborar-lote-form";
import type { DatosParaElaborar } from "@/modules/stock/application/datos-para-elaborar";

vi.mock("@/modules/stock/ui/actions", () => ({
  datosParaElaborarAction: vi.fn(),
  elaborarLoteAction: vi.fn(),
}));

vi.mock("@/modules/stock/ui/buscar-drogas-stock-action", () => ({
  buscarDrogasStockAction: vi.fn(async () => []),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

describe("ElaborarLoteForm (precargar con la fórmula)", () => {
  it("renders with inicial = tipo FORMULA and datos with formula, and button Precargar has no disabled attribute even without cantidad producida", () => {
    const datos: DatosParaElaborar = {
      droga: {
        id: "droga-1",
        nombre: "Crema Base Compuesta",
        clase: "DROGA",
        tipoControl: "GENERAL",
        unidadBaseSimbolo: "g",
        deBaja: false,
      },
      formula: {
        id: "formula-1",
        drogaId: "droga-1",
        cantidadReferencia: "100",
        componentes: [
          {
            drogaId: "materia-prima-1",
            drogaNombre: "Materia Prima A",
            cantidad: "40",
            unidadBaseSimbolo: "g",
          },
          {
            drogaId: "materia-prima-2",
            drogaNombre: "Materia Prima B",
            cantidad: "60",
            unidadBaseSimbolo: "g",
          },
        ],
      },
      partidasPorDroga: {
        "materia-prima-1": [],
        "materia-prima-2": [],
      },
      proximoLote: {
        DILUCION: "D-001",
        FORMULA: "L-001",
      },
      jornada: "2026-11-04",
      contralorActivo: false,
    };

    const html = renderToStaticMarkup(
      createElement(ElaborarLoteForm, {
        inicial: {
          datos,
          tipo: "FORMULA",
          partidaId: null,
        },
        onElaborado: vi.fn(),
      }),
    );

    expect(html).toContain("Precargar con la fórmula");

    // Match the specific <button> element that contains "Precargar con la fórmula"
    const match = html.match(/<button([^>]*)>[\s\S]*?Precargar con la fórmula[\s\S]*?<\/button>/);
    expect(match).not.toBeNull();
    const buttonAttrs = match![1]!;

    expect(buttonAttrs).not.toContain("disabled");
  });
});
