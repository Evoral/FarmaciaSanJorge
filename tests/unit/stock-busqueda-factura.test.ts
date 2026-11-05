/** Unit tests for `parseBusquedaFactura` (modules/stock/domain/busqueda-factura.ts), the /partidas "N° factura" filter. */
import { describe, it, expect } from "vitest";
import { parseBusquedaFactura } from "@/modules/stock/domain/busqueda-factura";

describe("parseBusquedaFactura", () => {
  it("reads punto de venta and número, without leading zeros", () => {
    expect(parseBusquedaFactura("0001-00012345")).toEqual({ puntoVenta: "1", numero: "12345" });
  });

  it("ignores the letra", () => {
    expect(parseBusquedaFactura("A 0001-00012345")).toEqual({ puntoVenta: "1", numero: "12345" });
  });

  it("reads a lone number as the número only", () => {
    expect(parseBusquedaFactura("12345")).toEqual({ numero: "12345" });
    expect(parseBusquedaFactura("00012345")).toEqual({ numero: "12345" });
  });

  it("keeps a single zero", () => {
    expect(parseBusquedaFactura("0")).toEqual({ numero: "0" });
    expect(parseBusquedaFactura("0000-0000")).toEqual({ puntoVenta: "0", numero: "0" });
  });

  it("uses the first group as punto de venta and the last as número", () => {
    expect(parseBusquedaFactura("A 0003 - 12 - 0045")).toEqual({ puntoVenta: "3", numero: "45" });
  });

  it("returns null without digits", () => {
    expect(parseBusquedaFactura("")).toBeNull();
    expect(parseBusquedaFactura("abc")).toBeNull();
  });
});
