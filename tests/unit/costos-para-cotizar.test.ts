/**
 * Unit tests for `costosParaCotizar` (openspec/changes/lotes-elaborados, R38 / R27).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FormulaLeida } from "@/modules/drogas/infrastructure/formula-repository";

const { getCostosProveedorVigentesDeDrogasMock, getFormulasDeDrogasMock } = vi.hoisted(() => ({
  getCostosProveedorVigentesDeDrogasMock: vi.fn(),
  getFormulasDeDrogasMock: vi.fn(),
}));

vi.mock("@/modules/costos-proveedor/infrastructure/costo-proveedor-repository", () => ({
  getCostosProveedorVigentesDeDrogas: getCostosProveedorVigentesDeDrogasMock,
}));

vi.mock("@/modules/drogas/infrastructure/formula-repository", () => ({
  getFormulasDeDrogas: getFormulasDeDrogasMock,
}));

const { costosParaCotizar } = await import(
  "@/modules/costos-proveedor/application/costos-proveedor-para-cotizar"
);

const TX = { __fakeTx: true } as never;
const TENANT = "11111111-1111-1111-1111-111111111111";

function costoCandidato(overrides: {
  id?: string;
  drogaId: string;
  proveedorId?: string;
  proveedorNombre?: string;
  costoUnitario?: string;
  alicuotaIva?: string;
  costoUnitarioConIva?: string;
  fechaPrecio?: string;
  vigenteDesde?: Date;
}) {
  return {
    id: overrides.id ?? "cp-1",
    drogaId: overrides.drogaId,
    proveedorId: overrides.proveedorId ?? "prov-1",
    proveedorNombre: overrides.proveedorNombre ?? "Proveedor 1",
    proveedorDeBaja: false,
    precioInformado: "100",
    unidadPrecioSimbolo: "g",
    costoUnitario: overrides.costoUnitario ?? "10",
    alicuotaIva: overrides.alicuotaIva ?? "21",
    precioInformadoConIva: "121",
    costoUnitarioConIva: overrides.costoUnitarioConIva ?? "12.1",
    fechaPrecio: overrides.fechaPrecio ?? "2026-10-01",
    vigenteDesde: overrides.vigenteDesde ?? new Date("2026-10-01T00:00:00Z"),
  };
}

describe("costosParaCotizar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCostosProveedorVigentesDeDrogasMock.mockResolvedValue([]);
    getFormulasDeDrogasMock.mockResolvedValue(new Map());
  });

  it("a droga with a costo de proveedor never reads fórmulas", async () => {
    getCostosProveedorVigentesDeDrogasMock.mockResolvedValueOnce([
      costoCandidato({ drogaId: "droga-1", costoUnitario: "5", costoUnitarioConIva: "6.05" }),
    ]);

    const resultado = await costosParaCotizar(TX, TENANT, ["droga-1"]);

    expect(getFormulasDeDrogasMock).not.toHaveBeenCalled();
    expect(resultado.proveedor.has("droga-1")).toBe(true);
    expect(resultado.formula.has("droga-1")).toBe(false);
    expect(resultado.componentesSinCosto.has("droga-1")).toBe(false);
  });

  it("a fully costed fórmula gives the right per-unit cost with and without IVA, plus each component's proveedor", async () => {
    // 1st call for drogaIds: jarabe has no costo
    getCostosProveedorVigentesDeDrogasMock.mockResolvedValueOnce([]);

    // formula for jarabe
    const formulaJarabe: FormulaLeida = {
      id: "form-1",
      drogaId: "droga-jarabe",
      cantidadReferencia: "100",
      componentes: [
        {
          drogaId: "droga-azucar",
          drogaNombre: "Azúcar",
          unidadBaseSimbolo: "g",
          cantidad: "85",
        },
      ],
    };
    getFormulasDeDrogasMock.mockResolvedValueOnce(new Map([["droga-jarabe", formulaJarabe]]));

    // 2nd call for componenteIds: azucar has costo 2 (con IVA 2.42)
    getCostosProveedorVigentesDeDrogasMock.mockResolvedValueOnce([
      costoCandidato({
        drogaId: "droga-azucar",
        proveedorNombre: "Droguería Sur",
        costoUnitario: "2",
        costoUnitarioConIva: "2.42",
      }),
    ]);

    const resultado = await costosParaCotizar(TX, TENANT, ["droga-jarabe"]);

    expect(resultado.proveedor.has("droga-jarabe")).toBe(false);
    expect(resultado.formula.has("droga-jarabe")).toBe(true);

    const f = resultado.formula.get("droga-jarabe")!;
    expect(f.cantidadReferencia).toBe("100");
    // 85 * 2 / 100 = 1.7
    expect(f.costoUnitario).toBe("1.7");
    // 85 * 2.42 / 100 = 2.057
    expect(f.costoUnitarioConIva).toBe("2.057");
    expect(f.componentes).toEqual([
      {
        drogaNombre: "Azúcar",
        cantidad: "85",
        unidadSimbolo: "g",
        proveedorNombre: "Droguería Sur",
        costoUnitarioConIva: "2.42",
      },
    ]);
  });

  it("a component without a costo goes to componentesSinCosto", async () => {
    getCostosProveedorVigentesDeDrogasMock.mockResolvedValueOnce([]);

    const formulaJarabe: FormulaLeida = {
      id: "form-1",
      drogaId: "droga-jarabe",
      cantidadReferencia: "100",
      componentes: [
        {
          drogaId: "droga-azucar",
          drogaNombre: "Azúcar",
          unidadBaseSimbolo: "g",
          cantidad: "85",
        },
        {
          drogaId: "droga-esencia",
          drogaNombre: "Esencia",
          unidadBaseSimbolo: "ml",
          cantidad: "5",
        },
      ],
    };
    getFormulasDeDrogasMock.mockResolvedValueOnce(new Map([["droga-jarabe", formulaJarabe]]));

    // only azucar has costo; esencia does not
    getCostosProveedorVigentesDeDrogasMock.mockResolvedValueOnce([
      costoCandidato({
        drogaId: "droga-azucar",
        costoUnitario: "2",
        costoUnitarioConIva: "2.42",
      }),
    ]);

    const resultado = await costosParaCotizar(TX, TENANT, ["droga-jarabe"]);

    expect(resultado.formula.has("droga-jarabe")).toBe(false);
    expect(resultado.componentesSinCosto.get("droga-jarabe")).toEqual(["Esencia"]);
  });

  it("a fórmula with no components gives no entry", async () => {
    getCostosProveedorVigentesDeDrogasMock.mockResolvedValueOnce([]);

    const formulaVacia: FormulaLeida = {
      id: "form-vacia",
      drogaId: "droga-vacia",
      cantidadReferencia: "100",
      componentes: [],
    };
    getFormulasDeDrogasMock.mockResolvedValueOnce(new Map([["droga-vacia", formulaVacia]]));

    const resultado = await costosParaCotizar(TX, TENANT, ["droga-vacia"]);

    expect(resultado.formula.has("droga-vacia")).toBe(false);
    expect(resultado.componentesSinCosto.has("droga-vacia")).toBe(false);
  });
});
