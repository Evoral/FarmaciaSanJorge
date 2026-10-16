/**
 * D8 (docs/specs/libro-recetario-y-contralor.md §1, 2026-10-16): one asiento per receta.
 *   - modules/preparaciones/domain/asiento-receta.ts: the fórmula text ("Ítem N: " ... joined by " | "), the detalle
 *     lines (ítem order, then each ítem's own order, `orden` continuous from 1), the asiento_preparacion order, and the
 *     legacy single path's rule (refused while another ítem is not CONFIRMADA).
 *   - `confirmarReservasReceta` ("Imprimir etiquetas"): every ítem confirmed, then ONE asiento with all of them, then
 *     the contralor egresos with its id, then the etiquetas (which print its Nº). Mocked repository/tx, no DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError } from "@/shared/errors";
import {
  ensamblarDetallesReceta,
  formatearFormulaReceta,
  MENSAJE_RECETA_CON_VARIOS_ITEMS,
  preparacionesDelAsiento,
  validarConfirmacionIndividual,
} from "@/modules/preparaciones/domain/asiento-receta";

const detalle = (lineaPesajeId: string, orden: number, descripcion = lineaPesajeId) => ({ lineaPesajeId, descripcion, cantidad: "1", unidadTexto: "g", orden });

describe("asiento por receta: contenido (D8)", () => {
  const items = [
    { numero: 2, preparacionId: "prep-2", formulaTexto: "Urea: 10 g", detalles: [detalle("l-2b", 1), detalle("l-2a", 0)] },
    { numero: 1, preparacionId: "prep-1", formulaTexto: "Ácido salicílico: 2 g; Vaselina: 98 g", detalles: [detalle("l-1a", 0), detalle("l-1b", 3)] },
  ];

  it("fórmula: each ítem in ítem order, prefixed by \"Ítem N: \", joined by \" | \"", () => {
    expect(formatearFormulaReceta(items)).toBe("Ítem 1: Ácido salicílico: 2 g; Vaselina: 98 g | Ítem 2: Urea: 10 g");
  });

  it("a single ítem keeps its \"Ítem N: \" prefix (its real position in the receta)", () => {
    expect(formatearFormulaReceta([{ numero: 3, formulaTexto: "Urea: 10 g" }])).toBe("Ítem 3: Urea: 10 g");
  });

  it("detalle: ítem order, then each ítem's own order; orden renumbered 1..n across the asiento", () => {
    expect(ensamblarDetallesReceta(items).map((d) => [d.lineaPesajeId, d.orden])).toEqual([
      ["l-1a", 1],
      ["l-1b", 2],
      ["l-2a", 3],
      ["l-2b", 4],
    ]);
  });

  it("detalle keeps every line's data untouched (only orden changes) and never mutates its input", () => {
    const [primero] = ensamblarDetallesReceta(items);
    expect(primero).toEqual({ lineaPesajeId: "l-1a", descripcion: "l-1a", cantidad: "1", unidadTexto: "g", orden: 1 });
    expect(items[0]!.detalles.map((d) => d.orden)).toEqual([1, 0]);
  });

  it("asiento_preparacion: the preparaciones in ítem order, orden 1..n", () => {
    expect(preparacionesDelAsiento(items)).toEqual([
      { preparacionId: "prep-1", orden: 1 },
      { preparacionId: "prep-2", orden: 2 },
    ]);
  });
});

describe("validarConfirmacionIndividual (legacy single path, D8)", () => {
  it("a single-ítem receta is allowed", () => {
    expect(() => validarConfirmacionIndividual([{ itemRecetaId: "i1", estadoPreparacion: "INICIADA" }], "i1")).not.toThrow();
  });

  it("allowed when every OTHER ítem is already CONFIRMADA (a receta from the transition)", () => {
    expect(() =>
      validarConfirmacionIndividual(
        [
          { itemRecetaId: "i1", estadoPreparacion: "CONFIRMADA" },
          { itemRecetaId: "i2", estadoPreparacion: "INICIADA" },
        ],
        "i2",
      ),
    ).not.toThrow();
  });

  it.each([
    ["pending (no live preparación)", null],
    ["with a preparación INICIADA", "INICIADA"],
  ] as const)("refused while another ítem is %s", (_caso, estadoPreparacion) => {
    const llamar = () =>
      validarConfirmacionIndividual(
        [
          { itemRecetaId: "i1", estadoPreparacion: "INICIADA" },
          { itemRecetaId: "i2", estadoPreparacion },
        ],
        "i1",
      );
    expect(llamar).toThrow(DomainError);
    expect(llamar).toThrow(MENSAJE_RECETA_CON_VARIOS_ITEMS);
  });

  it("the message is the spec's", () => {
    expect(MENSAJE_RECETA_CON_VARIOS_ITEMS).toBe("Esta receta tiene varios ítems: se registran juntos en el libro desde la toma (Imprimir etiquetas).");
  });
});

// ----------------------------------------------------------------------------
// confirmarReservasReceta: one asiento for every ítem it confirms.
// ----------------------------------------------------------------------------
vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true }),
}));
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const RECETA_ID = "22222222-2222-4222-a222-222222222222";
const USUARIO_ID = "66666666-6666-4666-a666-666666666666";
const orden: string[] = [];

const CONTEXTO = { recetaId: RECETA_ID, pacienteNombre: "Juan", pacienteApellido: "Pérez", medicoNombre: "Ana", medicoApellido: "Gómez", medicoMatricula: "MAT-1" };

const repo = {
  listItemIdsDeReceta: vi.fn(async () => ["item-1", "item-2"]),
  listPreparacionesVivasDeItems: vi.fn(async (): Promise<{ id: string; itemRecetaId: string; estado: string; etiquetaId: string | null }[]> => [
    { id: "prep-1", itemRecetaId: "item-1", estado: "INICIADA", etiquetaId: null },
    { id: "prep-2", itemRecetaId: "item-2", estado: "INICIADA", etiquetaId: null },
  ]),
  lockPreparacionesParaAccion: vi.fn(async (_tx: unknown, _tenant: string, ids: string[]) => [...ids]),
  lockRecetaParaTransicion: vi.fn(async () => true),
  listReservasDePreparacion: vi.fn(async (_tx: unknown, _tenant: string, id: string) => [
    { lineaPesajeId: `l-${id}`, partidaId: `p-${id}`, cantidad: "1", cantidadManual: null, motivoAperturaAdicional: null },
  ]),
  lockPartidasParaConfirmacion: vi.fn(async (_tx: unknown, _tenant: string, ids: string[]) => [...ids]),
  getAsientoSistemaDeReceta: vi.fn(async () => null as { numeroCorrelativo: string } | null),
  insertAsientoRecetario: vi.fn(async (...args: unknown[]) => {
    void args;
    orden.push("asiento");
    return { id: "asiento-1", numeroCorrelativo: "77" };
  }),
  insertAsientoContralorEgreso: vi.fn(async (...args: unknown[]) => {
    void args;
    orden.push("contralor");
    return { id: "contralor-1" };
  }),
};
vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", () => repo);

const confirmarDesdeReservasEnTx = vi.fn(async (_tx: unknown, _session: unknown, preparacionId: string) => {
  orden.push(`confirmar:${preparacionId}`);
  return {
    id: preparacionId,
    fechaVencimiento: "2026-09-15",
    contexto: CONTEXTO,
    formulaTexto: `Fórmula ${preparacionId}`,
    detalles: [detalle(`l-${preparacionId}`, 0)],
    egresosControlados:
      preparacionId === "prep-2" ? [{ movimientoId: "mov-2", drogaId: "droga-c", drogaNombre: "Clonazepam", unidadBaseId: "u-mg", cantidad: "2" }] : [],
  };
});
vi.mock("@/modules/preparaciones/application/confirmar-desde-reservas", () => ({
  confirmarDesdeReservasEnTx: (...args: [unknown, unknown, string]) => confirmarDesdeReservasEnTx(...args),
}));
const generarEtiquetaEnTx = vi.fn(async (_tx: unknown, _tenant: string, preparacionId: string) => {
  orden.push(`etiqueta:${preparacionId}`);
  return { id: `et-${preparacionId}`, preparacion: preparacionId };
});
vi.mock("@/modules/preparaciones/application/generar-etiqueta", () => ({
  generarEtiquetaEnTx: (...args: [unknown, string, string]) => generarEtiquetaEnTx(...args),
}));

const { confirmarReservasRecetaCommand } = await import("@/modules/preparaciones/application/confirmar-reservas-receta");

const session: AuthenticatedSession = {
  usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["preparaciones.confirmar", "etiquetas.generar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

describe("confirmarReservasReceta: ONE asiento for the receta (D8)", () => {
  beforeEach(() => {
    orden.length = 0;
    vi.clearAllMocks();
    repo.getAsientoSistemaDeReceta.mockResolvedValue(null);
  });

  it("confirms every ítem, then writes ONE asiento with all of them, then the contralor egresos, then the etiquetas", async () => {
    const resultado = await confirmarReservasRecetaCommand.execute({ recetaId: RECETA_ID }, { session });

    expect(orden).toEqual(["confirmar:prep-1", "confirmar:prep-2", "asiento", "contralor", "etiqueta:prep-1", "etiqueta:prep-2"]);
    expect(repo.insertAsientoRecetario).toHaveBeenCalledTimes(1);
    expect(repo.insertAsientoRecetario.mock.calls[0]![1]).toEqual({
      tenantId: TENANT_ID,
      recetaId: RECETA_ID,
      preparaciones: [
        { preparacionId: "prep-1", orden: 1 },
        { preparacionId: "prep-2", orden: 2 },
      ],
      pacienteTexto: "Pérez, Juan",
      medicoTexto: "Gómez, Ana — matrícula MAT-1",
      formulaTexto: "Ítem 1: Fórmula prep-1 | Ítem 2: Fórmula prep-2",
      registradoPorId: USUARIO_ID,
      detalles: [detalle("l-prep-1", 1), detalle("l-prep-2", 2)],
    });
    expect(repo.insertAsientoContralorEgreso).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ movimientoStockId: "mov-2", asientoRecetarioId: "asiento-1" }));
    expect(resultado).toEqual({
      asientoId: "asiento-1",
      numeroCorrelativo: "77",
      etiquetas: [
        { preparacionId: "prep-1", etiquetaId: "et-prep-1" },
        { preparacionId: "prep-2", etiquetaId: "et-prep-2" },
      ],
    });
  });

  it("an ítem already CONFIRMADA (per-ítem asiento from before D8) is skipped: the asiento covers only the others, keeping their ítem numbers", async () => {
    repo.listPreparacionesVivasDeItems.mockResolvedValue([
      { id: "prep-1", itemRecetaId: "item-1", estado: "CONFIRMADA", etiquetaId: "et-old" },
      { id: "prep-2", itemRecetaId: "item-2", estado: "INICIADA", etiquetaId: null },
    ]);

    await confirmarReservasRecetaCommand.execute({ recetaId: RECETA_ID }, { session });

    const asiento = repo.insertAsientoRecetario.mock.calls[0]![1] as { preparaciones: unknown; formulaTexto: string };
    expect(asiento.preparaciones).toEqual([{ preparacionId: "prep-2", orden: 1 }]);
    expect(asiento.formulaTexto).toBe("Ítem 2: Fórmula prep-2");
  });

  it("refuses when the receta already has its por-receta asiento (INV-L24 pre-check), writing nothing", async () => {
    repo.listPreparacionesVivasDeItems.mockResolvedValue([
      { id: "prep-1", itemRecetaId: "item-1", estado: "INICIADA", etiquetaId: null },
      { id: "prep-2", itemRecetaId: "item-2", estado: "INICIADA", etiquetaId: null },
    ]);
    repo.getAsientoSistemaDeReceta.mockResolvedValueOnce({ numeroCorrelativo: "12" });

    await expect(confirmarReservasRecetaCommand.execute({ recetaId: RECETA_ID }, { session })).rejects.toThrow("asiento Nº 12");
    expect(repo.insertAsientoRecetario).not.toHaveBeenCalled();
    expect(generarEtiquetaEnTx).not.toHaveBeenCalled();
  });
});
