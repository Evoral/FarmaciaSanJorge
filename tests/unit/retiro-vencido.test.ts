/**
 * Unit tests for the pure pieces of docs/specs/retiro-vencido.md (estado, parameter, /entregas filter).
 */
import { describe, it, expect } from "vitest";
import {
  DIAS_RETIRO_VENCIDO_DEFAULT,
  DIAS_RETIRO_VENCIDO_MAX,
  esRetiroVencido,
  instanteCorteRetiroVencido,
  parseDiasRetiroVencido,
  retiroVencidoDesactivado,
  sumarDiasAJornada,
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

// ---------------------------------------------------------------------------------------------------------------------
// RV1: the date arithmetic of the daily job. Mendoza is UTC-3 all year (no DST), so local midnight = 03:00Z.
// ---------------------------------------------------------------------------------------------------------------------
const ZONA = "America/Argentina/Mendoza";
const utc = (iso: string) => new Date(iso);

describe("sumarDiasAJornada", () => {
  it("moves a calendar day across month, year and leap boundaries", () => {
    expect(sumarDiasAJornada("2026-10-20", 30)).toBe("2026-11-19");
    expect(sumarDiasAJornada("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDiasAJornada("2028-03-01", -1)).toBe("2028-02-29");
    expect(sumarDiasAJornada("2026-10-20", 0)).toBe("2026-10-20");
  });
});

describe("instanteCorteRetiroVencido (RV1)", () => {
  it("N = 0 -> null: the vencimiento is disabled and nothing ever expires", () => {
    expect(instanteCorteRetiroVencido("2026-10-20", 0, ZONA)).toBeNull();
  });

  it("N = 1, running on jornada J: the cutoff is the start of jornada J (local midnight)", () => {
    expect(instanteCorteRetiroVencido("2026-10-20", 1, ZONA)).toEqual(utc("2026-10-20T03:00:00Z"));
  });

  it("N = 30: the cutoff is the start of jornada J - 29, i.e. a receta prepared on J - 30 is already expired", () => {
    expect(instanteCorteRetiroVencido("2026-10-20", 30, ZONA)).toEqual(utc("2026-09-21T03:00:00Z"));
  });

  it("uses the tenant's zone, not UTC", () => {
    expect(instanteCorteRetiroVencido("2026-10-20", 1, "UTC")).toEqual(utc("2026-10-20T00:00:00Z"));
    expect(instanteCorteRetiroVencido("2026-10-20", 1, "America/Argentina/Mendoza")).toEqual(utc("2026-10-20T03:00:00Z"));
  });
});

describe("esRetiroVencido (RV1)", () => {
  const base = { dias: 1, zonaHoraria: ZONA };

  it("N = 1: prepared at 23:59 local on D, it expires on the first run of D + 1 (even one minute later)", () => {
    const preparadaEn = utc("2026-10-02T02:59:00Z"); // 2026-10-01 23:59 local
    expect(esRetiroVencido({ ...base, preparadaEn, ahora: utc("2026-10-02T03:00:00Z") })).toBe(true); // 2026-10-02 00:00 local
    expect(esRetiroVencido({ ...base, preparadaEn, ahora: utc("2026-10-02T09:00:00Z") })).toBe(true); // the 06:00Z job run
  });

  it("N = 1: prepared at 00:01 local on D, it does NOT expire on D, only on D + 1", () => {
    const preparadaEn = utc("2026-10-02T03:01:00Z"); // 2026-10-02 00:01 local
    expect(esRetiroVencido({ ...base, preparadaEn, ahora: utc("2026-10-02T20:00:00Z") })).toBe(false); // same jornada, 17:00 local
    expect(esRetiroVencido({ ...base, preparadaEn, ahora: utc("2026-10-03T06:00:00Z") })).toBe(true); // D + 1, the 03:00 local run
  });

  it("the jornada boundary is local midnight, not UTC midnight (21:00 local is already the next day in UTC)", () => {
    const preparadaEn = utc("2026-10-02T00:30:00Z"); // 2026-10-01 21:30 local, jornada 10-01
    expect(esRetiroVencido({ ...base, preparadaEn, ahora: utc("2026-10-02T02:59:00Z") })).toBe(false); // still jornada 10-01
    expect(esRetiroVencido({ ...base, preparadaEn, ahora: utc("2026-10-02T03:00:00Z") })).toBe(true); // jornada 10-02
  });

  it("N = 30: expires on the first run of D + 30, not before", () => {
    const preparadaEn = utc("2026-09-20T15:00:00Z"); // jornada 2026-09-20
    expect(esRetiroVencido({ dias: 30, zonaHoraria: ZONA, preparadaEn, ahora: utc("2026-10-19T09:00:00Z") })).toBe(false); // D + 29
    expect(esRetiroVencido({ dias: 30, zonaHoraria: ZONA, preparadaEn, ahora: utc("2026-10-20T09:00:00Z") })).toBe(true); // D + 30
    expect(esRetiroVencido({ dias: 30, zonaHoraria: ZONA, preparadaEn, ahora: utc("2026-12-01T09:00:00Z") })).toBe(true); // a missed run still catches up
  });

  it("N = 0 never expires, however old the receta is", () => {
    expect(esRetiroVencido({ dias: 0, zonaHoraria: ZONA, preparadaEn: utc("2020-01-01T00:00:00Z"), ahora: utc("2026-10-20T09:00:00Z") })).toBe(false);
  });

  it("a PREPARADA receta without preparada_en never expires (nothing to count from)", () => {
    expect(esRetiroVencido({ ...base, preparadaEn: null, ahora: utc("2026-10-20T09:00:00Z") })).toBe(false);
  });

  it("agrees with the cutoff the job's SQL uses (preparada_en < corte), around every boundary and for several N", () => {
    const ahora = utc("2026-10-20T09:00:00Z"); // 06:00 local, jornada 2026-10-20
    for (const dias of [1, 2, 7, 30, 365]) {
      const corte = instanteCorteRetiroVencido("2026-10-20", dias, ZONA);
      expect(corte).not.toBeNull();
      for (const offsetMin of [-1441, -1, 0, 1, 1439, 1440]) {
        const preparadaEn = new Date(corte!.getTime() + offsetMin * 60_000);
        expect(esRetiroVencido({ dias, zonaHoraria: ZONA, preparadaEn, ahora }), `N=${dias} offset=${offsetMin}`).toBe(preparadaEn.getTime() < corte!.getTime());
      }
    }
  });
});
