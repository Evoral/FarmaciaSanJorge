/** Unit tests for `modules/libro/domain/estado-visual.ts` (FASE 9, M12 point 9.1). Pure function, no mocks. */
import { describe, it, expect } from "vitest";
import { resolverEstadoVisualAsiento, etiquetaEstadoVisual } from "@/modules/libro/domain/estado-visual";

describe("resolverEstadoVisualAsiento", () => {
  it("VIGENTE with no anulación and no rectificativo -> VIGENTE", () => {
    const estado = resolverEstadoVisualAsiento({ estado: "VIGENTE", anulacion: null, rectificativoNumeroCorrelativo: null });
    expect(estado).toEqual({ kind: "VIGENTE" });
    expect(etiquetaEstadoVisual(estado)).toBe("Vigente");
  });

  it("ANULADO with its anulación row -> ANULADO, carrying motivo/anulado-por/autorizado-por/fecha", () => {
    const anuladoEn = new Date("2026-06-15T12:00:00Z");
    const estado = resolverEstadoVisualAsiento({
      estado: "ANULADO",
      anulacion: { motivo: "El paciente no retira", anuladoPorNombre: "Pérez, Ana", autorizadoPorNombre: "Gómez, Juan", anuladoEn },
      rectificativoNumeroCorrelativo: null,
    });
    expect(estado).toEqual({ kind: "ANULADO", motivo: "El paciente no retira", anuladoPorNombre: "Pérez, Ana", autorizadoPorNombre: "Gómez, Juan", anuladoEn });
    expect(etiquetaEstadoVisual(estado)).toBe("Anulado");
  });

  it("[DEDUCCIÓN spec §1] VIGENTE in the DB but with a linked rectificativo -> displayed as 'sin efecto', never as ANULADO", () => {
    const estado = resolverEstadoVisualAsiento({ estado: "VIGENTE", anulacion: null, rectificativoNumeroCorrelativo: "42" });
    expect(estado).toEqual({ kind: "SIN_EFECTO", rectificativoNumeroCorrelativo: "42" });
    expect(etiquetaEstadoVisual(estado)).toBe("Sin efecto por asiento Nº 42");
  });

  it("ANULADO takes priority when (defensively) both anulación and rectificativo data are present", () => {
    const anuladoEn = new Date("2026-06-15T12:00:00Z");
    const estado = resolverEstadoVisualAsiento({
      estado: "ANULADO",
      anulacion: { motivo: "m", anuladoPorNombre: "a", autorizadoPorNombre: "b", anuladoEn },
      rectificativoNumeroCorrelativo: "9",
    });
    expect(estado.kind).toBe("ANULADO");
  });
});
