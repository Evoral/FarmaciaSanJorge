/**
 * Every enum value the UI can show has a Spanish label: each map in
 * shared/labels/enum-labels.ts (and the module-local maps it defers to) is
 * checked against the RUNTIME values of the Prisma enum it labels, so
 * adding a value to schema.prisma without a label fails here.
 */
import { describe, it, expect } from "vitest";
import * as PrismaEnums from "@/generated/prisma/enums";
import {
  ESTADO_PREPARACION_LABELS,
  ESTADO_RECETA_LABELS,
  ESTADO_USUARIO_LABELS,
  FORMA_FARMACEUTICA_LABELS,
  MODO_EXPRESION_LABELS,
  ORIGEN_RECETA_LABELS,
  TIPO_LIBRO_LABELS,
  TIPO_MOVIMIENTO_CONTRALOR_LABELS,
  TIPO_MOVIMIENTO_LABELS,
  etiquetaDe,
} from "@/shared/labels/enum-labels";
import { FORMAS_FARMACEUTICAS, MODOS_EXPRESION, ESTADOS_RECETA, ORIGENES_RECETA } from "@/modules/recetas/domain/receta";
import { TIPO_MAGNITUD_LABELS } from "@/modules/unidades/domain/unidad";
import { MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { JURISDICCION_MATRICULA_LABELS } from "@/modules/medicos/domain/medico";

const MAPAS: ReadonlyArray<[keyof typeof PrismaEnums, Readonly<Record<string, string>>]> = [
  ["FormaFarmaceutica", FORMA_FARMACEUTICA_LABELS],
  ["ModoExpresion", MODO_EXPRESION_LABELS],
  ["EstadoReceta", ESTADO_RECETA_LABELS],
  ["EstadoPreparacion", ESTADO_PREPARACION_LABELS],
  ["EstadoUsuario", ESTADO_USUARIO_LABELS],
  ["OrigenReceta", ORIGEN_RECETA_LABELS],
  ["TipoLibro", TIPO_LIBRO_LABELS],
  ["TipoMovimiento", TIPO_MOVIMIENTO_LABELS],
  ["TipoMovimientoContralor", TIPO_MOVIMIENTO_CONTRALOR_LABELS],
  ["TipoMagnitud", TIPO_MAGNITUD_LABELS],
  ["MotivoAjuste", MOTIVO_AJUSTE_LABELS],
  ["JurisdiccionMatricula", JURISDICCION_MATRICULA_LABELS],
];

describe("enum label maps", () => {
  for (const [nombre, mapa] of MAPAS) {
    it(`${nombre}: exactly one non-empty label per value`, () => {
      const valores = Object.values(PrismaEnums[nombre] as Record<string, string>);
      expect(Object.keys(mapa).sort()).toEqual([...valores].sort());
      for (const v of valores) {
        expect(mapa[v]!.trim().length, v).toBeGreaterThan(0);
        expect(mapa[v], `${v} is still a raw code`).not.toBe(v);
      }
    });
  }

  it("the domain value lists match the Prisma enums (forms and filters iterate them)", () => {
    expect([...FORMAS_FARMACEUTICAS].sort()).toEqual(Object.values(PrismaEnums.FormaFarmaceutica).sort());
    expect([...MODOS_EXPRESION].sort()).toEqual(Object.values(PrismaEnums.ModoExpresion).sort());
    expect([...ESTADOS_RECETA].sort()).toEqual(Object.values(PrismaEnums.EstadoReceta).sort());
    expect([...ORIGENES_RECETA].sort()).toEqual(Object.values(PrismaEnums.OrigenReceta).sort());
  });

  it("uses proper Spanish", () => {
    expect(FORMA_FARMACEUTICA_LABELS.UNGUENTO).toBe("Ungüento");
    expect(FORMA_FARMACEUTICA_LABELS.CAPSULA).toBe("Cápsula");
    expect(MODO_EXPRESION_LABELS.CSP).toBe("c.s.p.");
    expect(ESTADO_RECETA_LABELS.PENDIENTE_PREPARACION).toBe("Pendiente de preparación");
  });

  it("etiquetaDe falls back to the raw value only outside the enum", () => {
    expect(etiquetaDe(ESTADO_PREPARACION_LABELS, "INICIADA")).toBe("Iniciada");
    expect(etiquetaDe(ESTADO_PREPARACION_LABELS, "OTRO")).toBe("OTRO");
    expect(etiquetaDe(ESTADO_PREPARACION_LABELS, "constructor")).toBe("constructor");
  });
});
