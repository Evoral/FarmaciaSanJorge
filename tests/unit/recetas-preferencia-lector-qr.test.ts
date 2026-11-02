/** openspec/changes/lector-qr-configurable (P80–P82): the equipo's modo del lector, stored in the browser per farmacia. */
import { describe, expect, it } from "vitest";
import {
  clavePreferenciaLectorQr,
  guardarPreferenciaLectorQr,
  leerPreferenciaLectorQr,
  type AlmacenPreferencia,
} from "@/modules/recetas/ui/preferencia-lector-qr";

const TENANT = "11111111-1111-4111-a111-111111111111";
const OTRO_TENANT = "22222222-2222-4222-a222-222222222222";

function almacenEnMemoria(inicial: Record<string, string> = {}): AlmacenPreferencia & { datos: Map<string, string> } {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (clave) => datos.get(clave) ?? null,
    setItem: (clave, valor) => void datos.set(clave, valor),
    removeItem: (clave) => void datos.delete(clave),
  };
}

const almacenQueFalla: AlmacenPreferencia = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("leerPreferenciaLectorQr", () => {
  it("reads the stored mode of this farmacia only", () => {
    const almacen = almacenEnMemoria({ [clavePreferenciaLectorQr(TENANT)]: "LECTOR" });
    expect(leerPreferenciaLectorQr(almacen, TENANT)).toBe("LECTOR");
    expect(leerPreferenciaLectorQr(almacen, OTRO_TENANT)).toBe("FARMACIA");
  });

  it.each([null, "basura", "camara"])("follows the farmacia when the stored value is %j", (valor) => {
    const almacen = almacenEnMemoria(valor === null ? {} : { [clavePreferenciaLectorQr(TENANT)]: valor });
    expect(leerPreferenciaLectorQr(almacen, TENANT)).toBe("FARMACIA");
  });

  it("follows the farmacia without a storage or when it throws", () => {
    expect(leerPreferenciaLectorQr(null, TENANT)).toBe("FARMACIA");
    expect(leerPreferenciaLectorQr(almacenQueFalla, TENANT)).toBe("FARMACIA");
  });
});

describe("guardarPreferenciaLectorQr", () => {
  it("stores a mode and 'Según la farmacia' removes it", () => {
    const almacen = almacenEnMemoria();
    expect(guardarPreferenciaLectorQr(almacen, TENANT, "CAMARA")).toBe(true);
    expect(almacen.datos.get(clavePreferenciaLectorQr(TENANT))).toBe("CAMARA");
    expect(guardarPreferenciaLectorQr(almacen, TENANT, "FARMACIA")).toBe(true);
    expect(almacen.datos.has(clavePreferenciaLectorQr(TENANT))).toBe(false);
  });

  it("reports a failed save instead of throwing", () => {
    expect(guardarPreferenciaLectorQr(null, TENANT, "LECTOR")).toBe(false);
    expect(guardarPreferenciaLectorQr(almacenQueFalla, TENANT, "LECTOR")).toBe(false);
  });
});
