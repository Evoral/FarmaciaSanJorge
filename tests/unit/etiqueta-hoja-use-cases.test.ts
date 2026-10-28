/**
 * Use cases of the sheet (openspec/specs/hoja-etiquetas/spec.md R2, R5, R7, R13): the input
 * schema of `editarEtiquetaHoja`, the "no active size may stop fitting" rule, the
 * fit check of crear / editar / reactivar a size, and the print list that hides the
 * sizes that do not fit. The pipeline's edges and both repositories are mocked (same
 * approach as tests/unit/etiqueta-tamanos-baja.test.ts) so the handlers' own
 * decisions are what is tested.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, ValidationError } from "@/shared/errors";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const hojaRepo = vi.hoisted(() => ({
  getEtiquetaHoja: vi.fn(),
  lockEtiquetaHoja: vi.fn(),
  lockEtiquetaHojaCompartida: vi.fn(),
  upsertEtiquetaHoja: vi.fn(),
}));
const tamanoRepo = vi.hoisted(() => ({
  existeNombre: vi.fn(),
  insertEtiquetaTamano: vi.fn(),
  lockEtiquetaTamano: vi.fn(),
  getEtiquetaTamano: vi.fn(),
  updateEtiquetaTamanoDatos: vi.fn(),
  cambiarActivoEtiquetaTamano: vi.fn(),
  listEtiquetaTamanosActivos: vi.fn(),
}));
vi.mock("@/modules/etiqueta-tamanos/infrastructure/etiqueta-hoja-repository", () => hojaRepo);
vi.mock("@/modules/etiqueta-tamanos/infrastructure/etiqueta-tamano-repository", () => tamanoRepo);

const { editarEtiquetaHojaCommand, editarEtiquetaHojaInput, AREA_UTIL_MESSAGE } = await import("@/modules/etiqueta-tamanos/application/editar-etiqueta-hoja");
const { crearEtiquetaTamanoCommand } = await import("@/modules/etiqueta-tamanos/application/crear-etiqueta-tamano");
const { editarEtiquetaTamanoCommand } = await import("@/modules/etiqueta-tamanos/application/editar-etiqueta-tamano");
const { reactivarEtiquetaTamanoCommand } = await import("@/modules/etiqueta-tamanos/application/reactivar-etiqueta-tamano");
const { listTamanosParaImprimirQuery } = await import("@/modules/etiqueta-tamanos/application/list-tamanos-para-imprimir");

const TAMANO_ID = "22222222-2222-4222-8222-222222222222";
const A4 = { anchoMm: 210, altoMm: 297, margenMm: 5 };

const session: AuthenticatedSession = {
  usuario: { id: "u1", email: "admin@example.com", nombre: "N", apellido: "A" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(["config.editar", "etiquetas.imprimir"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  hojaRepo.getEtiquetaHoja.mockResolvedValue(A4);
  tamanoRepo.existeNombre.mockResolvedValue(false);
  tamanoRepo.insertEtiquetaTamano.mockResolvedValue({ id: TAMANO_ID });
  tamanoRepo.lockEtiquetaTamano.mockResolvedValue(true);
  tamanoRepo.listEtiquetaTamanosActivos.mockResolvedValue([]);
});

describe("editarEtiquetaHojaInput (R2)", () => {
  const base = { anchoMm: "210", altoMm: "297", margenMm: "5" };

  it("reads typed measures with comma or dot decimals", () => {
    const result = editarEtiquetaHojaInput.safeParse({ anchoMm: "215,9", altoMm: "279.4", margenMm: "4,5" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ anchoMm: 215.9, altoMm: 279.4, margenMm: 4.5 });
  });

  it("accepts the limits: sheet 50..500, margin 0..30", () => {
    expect(editarEtiquetaHojaInput.safeParse({ anchoMm: "50", altoMm: "500", margenMm: "0" }).success).toBe(true);
    expect(editarEtiquetaHojaInput.safeParse({ anchoMm: "500", altoMm: "50", margenMm: "30" }).success).toBe(true);
  });

  it("rejects values outside the limits", () => {
    expect(editarEtiquetaHojaInput.safeParse({ ...base, anchoMm: "49,9" }).success).toBe(false);
    expect(editarEtiquetaHojaInput.safeParse({ ...base, altoMm: "500,1" }).success).toBe(false);
    expect(editarEtiquetaHojaInput.safeParse({ ...base, margenMm: "30,1" }).success).toBe(false);
    expect(editarEtiquetaHojaInput.safeParse({ ...base, margenMm: "-1" }).success).toBe(false);
  });

  it("rejects more than one decimal, empty and non-numeric values, and unknown keys", () => {
    expect(editarEtiquetaHojaInput.safeParse({ ...base, anchoMm: "210,55" }).success).toBe(false);
    expect(editarEtiquetaHojaInput.safeParse({ ...base, margenMm: "" }).success).toBe(false);
    expect(editarEtiquetaHojaInput.safeParse({ ...base, altoMm: "abc" }).success).toBe(false);
    expect(editarEtiquetaHojaInput.safeParse({ ...base, activo: true }).success).toBe(false);
  });
});

describe("editarEtiquetaHoja (R5, R13)", () => {
  const editar = (input: { anchoMm: string; altoMm: string; margenMm: string }) => editarEtiquetaHojaCommand.execute(input, { session });

  it("saves the sheet and audits before / after of the three measures", async () => {
    const resultado = await editar({ anchoMm: "297", altoMm: "210", margenMm: "0" });

    expect(resultado).toEqual({ anchoMm: 297, altoMm: 210, margenMm: 0 });
    expect(hojaRepo.upsertEtiquetaHoja).toHaveBeenCalledWith(expect.anything(), session.tenantId, { anchoMm: 297, altoMm: 210, margenMm: 0 });
  });

  it("locks the sheet BEFORE reading it and the active sizes", async () => {
    await editar({ anchoMm: "297", altoMm: "210", margenMm: "0" });

    const lock = hojaRepo.lockEtiquetaHoja.mock.invocationCallOrder[0]!;
    expect(lock).toBeLessThan(hojaRepo.getEtiquetaHoja.mock.invocationCallOrder[0]!);
    expect(lock).toBeLessThan(tamanoRepo.listEtiquetaTamanosActivos.mock.invocationCallOrder[0]!);
  });

  it("a margin that leaves less than 10 mm of printable area is a field error on margenMm and saves nothing", async () => {
    const error = await editar({ anchoMm: "50", altoMm: "50", margenMm: "20,1" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(AREA_UTIL_MESSAGE);
    expect((error as ValidationError).fields).toEqual(["margenMm"]);
    expect(hojaRepo.upsertEtiquetaHoja).not.toHaveBeenCalled();
  });

  it("rejects the edit when an ACTIVE size would stop fitting, naming it, and saves nothing", async () => {
    tamanoRepo.listEtiquetaTamanosActivos.mockResolvedValue([
      { id: "a", nombre: "Estándar 100 × 42 mm", anchoMm: 100, altoMm: 42 },
      { id: "b", nombre: "Ancho", anchoMm: 190, altoMm: 40 },
    ]);

    const error = await editar({ anchoMm: "150", altoMm: "297", margenMm: "5" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain('"Ancho"');
    expect((error as ValidationError).message).not.toContain("Estándar");
    expect((error as ValidationError).fields).toEqual(["anchoMm"]);
    expect(hojaRepo.upsertEtiquetaHoja).not.toHaveBeenCalled();
  });

  it("a size that ALREADY does not fit the current sheet does not block the edit", async () => {
    tamanoRepo.listEtiquetaTamanosActivos.mockResolvedValue([{ id: "x", nombre: "Rollo 250", anchoMm: 250, altoMm: 30 }]);

    await expect(editar({ anchoMm: "200", altoMm: "297", margenMm: "5" })).resolves.toBeDefined();
    expect(hojaRepo.upsertEtiquetaHoja).toHaveBeenCalledTimes(1);
  });

  it("an edit that enlarges the sheet never conflicts with a fitting size", async () => {
    tamanoRepo.listEtiquetaTamanosActivos.mockResolvedValue([{ id: "a", nombre: "Estándar", anchoMm: 100, altoMm: 42 }]);

    await expect(editar({ anchoMm: "300", altoMm: "400", margenMm: "0" })).resolves.toBeDefined();
  });
});

describe("the fit check of a size (R5)", () => {
  it("crear rejects a size wider than the printable area with a field error on anchoMm", async () => {
    const error = await crearEtiquetaTamanoCommand.execute({ nombre: "Rollo", anchoMm: "250", altoMm: "30" }, { session }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["anchoMm"]);
    expect((error as ValidationError).message).toContain("A4 vertical — 210 × 297 mm, margen 5 mm");
    expect((error as ValidationError).message).toContain("200 × 287 mm");
    expect(tamanoRepo.insertEtiquetaTamano).not.toHaveBeenCalled();
  });

  it("crear accepts a size that fits and holds the sheet FOR SHARE first", async () => {
    await expect(crearEtiquetaTamanoCommand.execute({ nombre: "Estándar", anchoMm: "100", altoMm: "42" }, { session })).resolves.toEqual({ id: TAMANO_ID });
    expect(hojaRepo.lockEtiquetaHojaCompartida).toHaveBeenCalledTimes(1);
    expect(hojaRepo.lockEtiquetaHojaCompartida.mock.invocationCallOrder[0]!).toBeLessThan(hojaRepo.getEtiquetaHoja.mock.invocationCallOrder[0]!);
  });

  it("crear accepts an exact fit (200 x 287 on A4 / 5 mm)", async () => {
    await expect(crearEtiquetaTamanoCommand.execute({ nombre: "Todo", anchoMm: "200", altoMm: "287" }, { session })).resolves.toBeDefined();
  });

  it("editar rejects measures that do not fit (both fields) and updates nothing", async () => {
    tamanoRepo.getEtiquetaTamano.mockResolvedValue({ id: TAMANO_ID, nombre: "Rollo", anchoMm: 100, altoMm: 42, activo: true });

    const error = await editarEtiquetaTamanoCommand.execute({ id: TAMANO_ID, nombre: "Rollo", anchoMm: "250", altoMm: "290" }, { session }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual(["anchoMm", "altoMm"]);
    expect(tamanoRepo.updateEtiquetaTamanoDatos).not.toHaveBeenCalled();
  });

  it("reactivar refuses a size that does not fit, and reactivates one that does", async () => {
    tamanoRepo.getEtiquetaTamano.mockResolvedValue({ id: TAMANO_ID, nombre: "Rollo", anchoMm: 250, altoMm: 30, activo: false });
    const error = await reactivarEtiquetaTamanoCommand.execute({ id: TAMANO_ID, motivo: "Se volvió a usar" }, { session }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toContain("no entra en la hoja");
    expect(tamanoRepo.cambiarActivoEtiquetaTamano).not.toHaveBeenCalled();

    tamanoRepo.getEtiquetaTamano.mockResolvedValue({ id: TAMANO_ID, nombre: "Chico", anchoMm: 50, altoMm: 30, activo: false });
    await reactivarEtiquetaTamanoCommand.execute({ id: TAMANO_ID, motivo: "Se volvió a usar" }, { session });
    expect(tamanoRepo.cambiarActivoEtiquetaTamano).toHaveBeenCalledWith(expect.anything(), session.tenantId, TAMANO_ID, true);
  });
});

describe("listTamanosParaImprimir (R5)", () => {
  it("offers only the active sizes that fit the sheet, in order", async () => {
    tamanoRepo.listEtiquetaTamanosActivos.mockResolvedValue([
      { id: "a", nombre: "Ancho", anchoMm: 250, altoMm: 30 },
      { id: "b", nombre: "Chico", anchoMm: 50, altoMm: 30 },
      { id: "c", nombre: "Estándar", anchoMm: 100, altoMm: 42 },
    ]);

    const tamanos = await listTamanosParaImprimirQuery.execute({}, { session });

    expect(tamanos.map((t: { id: string }) => t.id)).toEqual(["b", "c"]);
  });

  it("is empty when nothing fits", async () => {
    tamanoRepo.listEtiquetaTamanosActivos.mockResolvedValue([{ id: "a", nombre: "Ancho", anchoMm: 250, altoMm: 30 }]);
    await expect(listTamanosParaImprimirQuery.execute({}, { session })).resolves.toEqual([]);
  });
});
