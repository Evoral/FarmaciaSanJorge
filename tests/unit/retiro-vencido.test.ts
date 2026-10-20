/**
 * Unit tests for the pure pieces of docs/specs/retiro-vencido.md (estado, parameter, /entregas filter).
 */
import { describe, it, expect } from "vitest";
import {
  DIAS_RETIRO_VENCIDO_DEFAULT,
  DIAS_RETIRO_VENCIDO_MAX,
  parseDiasRetiroVencido,
  retiroVencidoDesactivado,
} from "@/modules/entregas/domain/retiro-vencido";
import { ESTADOS_FILTRO_ENTREGAS, estadoFiltroEntregas, puedeRegistrarEntrega } from "@/modules/entregas/domain/entrega";
import { PARAMETROS_REGISTRY } from "@/modules/parametros/domain/parametros-registry";
import { ESTADOS_RECETA } from "@/modules/recetas/domain/receta";
import { ESTADO_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { estadoTone } from "@/shared/ui/status-badge";

describe("parseDiasRetiroVencido", () => {
  it("reads a non-negative integer within [0, 365], trimmed", () => {
    expect(parseDiasRetiroVencido("0")).toBe(0);
    expect(parseDiasRetiroVencido("7")).toBe(7);
    expect(parseDiasRetiroVencido(" 45 ")).toBe(45);
    expect(parseDiasRetiroVencido(String(DIAS_RETIRO_VENCIDO_MAX))).toBe(DIAS_RETIRO_VENCIDO_MAX);
  });

  it("falls back to the default (30) on no row, empty, non-numeric, negative, fractional or out of range", () => {
    expect(DIAS_RETIRO_VENCIDO_DEFAULT).toBe(30);
    for (const raw of [null, undefined, "", "  ", "abc", "-1", "1.5", "1,5", "366", "99999999999999999999"]) {
      expect(parseDiasRetiroVencido(raw), String(raw)).toBe(DIAS_RETIRO_VENCIDO_DEFAULT);
    }
  });

  it("0 is a real value (disabled), not a fallback", () => {
    expect(retiroVencidoDesactivado(parseDiasRetiroVencido("0"))).toBe(true);
    expect(retiroVencidoDesactivado(parseDiasRetiroVencido("30"))).toBe(false);
    expect(retiroVencidoDesactivado(parseDiasRetiroVencido("abc"))).toBe(false);
  });

  it("the registry default is the one the reader falls back to", () => {
    expect(PARAMETROS_REGISTRY.dias_retiro_vencido.valorPorDefecto).toBe(String(DIAS_RETIRO_VENCIDO_DEFAULT));
  });
});

describe("RETIRO_VENCIDO estado", () => {
  it("is one of the receta estados, with its label and the warn tone", () => {
    expect(ESTADOS_RECETA).toContain("RETIRO_VENCIDO");
    expect(ESTADO_RECETA_LABELS.RETIRO_VENCIDO).toBe("Retiro vencido");
    expect(estadoTone("RETIRO_VENCIDO")).toBe("warn");
  });

  it("an entrega cannot be registered from it (only from PREPARADA)", () => {
    expect(puedeRegistrarEntrega("RETIRO_VENCIDO")).toBe(false);
    expect(puedeRegistrarEntrega("PREPARADA")).toBe(true);
  });
});

describe("/entregas estado filter", () => {
  it("accepts PREPARADA, ENVIADA_PEND_FIRMA and RETIRO_VENCIDO, nothing else", () => {
    expect([...ESTADOS_FILTRO_ENTREGAS]).toEqual(["PREPARADA", "ENVIADA_PEND_FIRMA", "RETIRO_VENCIDO"]);
    expect(estadoFiltroEntregas("RETIRO_VENCIDO")).toBe("RETIRO_VENCIDO");
    expect(estadoFiltroEntregas("PREPARADA")).toBe("PREPARADA");
    for (const raw of ["ENTREGADA", "ANULADA", "", "retiro_vencido", null, undefined]) {
      expect(estadoFiltroEntregas(raw), String(raw)).toBeUndefined();
    }
  });
});
