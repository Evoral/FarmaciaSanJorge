/**
 * `precios.reglas.editar` (modules/precios/application/guardar-regla-precio.ts)
 * through the REAL pipeline with only the repository mocked (no DB): the
 * input is validated by the pure `validarReglasPrecio` (labeled, per-tramo
 * messages), and a valid rule set closes the open version and inserts the
 * new one with its tramos in order (INV-PR-001). DB-level enforcement
 * (INV-PR-002) is tests/db/regla-precio-cotizacion.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ValidationError } from "@/shared/errors";

const auditRecord = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecord(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
const FAKE_TX = { __fakeTx: true };
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn(FAKE_TX),
}));
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const AHORA = new Date("2026-10-01T12:00:00.000Z");
const repo = {
  lockReglaAbierta: vi.fn(),
  ahoraServidor: vi.fn(async () => AHORA),
  cerrarReglaAbierta: vi.fn(async () => undefined),
  insertReglaPrecio: vi.fn(async (_tx: unknown, input: { precioMinimo: string; tramos: { costoHasta: string | null; margen: string }[]; vigenteDesde: Date }) => ({
    id: "nueva",
    precioMinimo: input.precioMinimo,
    tramos: input.tramos,
    vigenteDesde: input.vigenteDesde,
  })),
};
vi.mock("@/modules/precios/infrastructure/regla-precio-repository", () => repo);

const { guardarReglaPrecioCommand } = await import("@/modules/precios/application/guardar-regla-precio");

const SESSION: AuthenticatedSession = {
  usuario: { id: "u-1", email: "u@example.com", nombre: "N", apellido: "A" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(["precios.reglas.editar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

function guardar(input: unknown) {
  return guardarReglaPrecioCommand.execute(input as never, { session: SESSION });
}

const EJEMPLO = {
  precioMinimo: "20000",
  tramos: [
    { costoHasta: "100000", margen: "100" },
    { costoHasta: null, margen: "70" },
  ],
};

beforeEach(() => {
  repo.lockReglaAbierta.mockReset().mockResolvedValue(null);
  repo.cerrarReglaAbierta.mockClear();
  repo.insertReglaPrecio.mockClear();
  auditRecord.mockClear();
});

describe("precios.reglas.editar", () => {
  it("first regla: plain insert of the header + tramos in order, nothing closed", async () => {
    const out = await guardar(EJEMPLO);
    expect(repo.cerrarReglaAbierta).not.toHaveBeenCalled();
    expect(repo.insertReglaPrecio).toHaveBeenCalledWith(FAKE_TX, {
      tenantId: SESSION.tenantId,
      precioMinimo: "20000",
      tramos: [
        { costoHasta: "100000", margen: "100" },
        { costoHasta: null, margen: "70" },
      ],
      vigenteDesde: AHORA,
      creadoPorId: "u-1",
    });
    expect(out).toMatchObject({ id: "nueva", precioMinimo: "20000", vigenteDesde: AHORA.toISOString() });
  });

  it("an open regla is closed at the same instant the new version starts (INV-PR-001), audited with a readable tramo summary", async () => {
    repo.lockReglaAbierta.mockResolvedValue({ id: "vieja", precioMinimo: "0", tramos: [{ costoHasta: null, margen: "150" }], vigenteDesde: new Date("2026-09-22T00:00:00Z") });
    await guardar(EJEMPLO);
    expect(repo.cerrarReglaAbierta).toHaveBeenCalledWith(FAKE_TX, SESSION.tenantId, "vieja", AHORA);
    const auditArgs = JSON.stringify(auditRecord.mock.calls);
    expect(auditArgs).toContain("cualquier costo: +150%");
    expect(auditArgs).toContain("hasta 100000: +100%; más de 100000: +70%");
  });

  it("rejects overlapping tramos with a labeled per-tramo message, before touching the DB", async () => {
    const error = await guardar({
      precioMinimo: "0",
      tramos: [
        { costoHasta: "1000", margen: "10" },
        { costoHasta: "1000", margen: "10" },
        { costoHasta: null, margen: "10" },
      ],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain("Tramos de margen › n.º 2 › Costo hasta");
    expect((error as ValidationError).fields).toEqual(["tramos"]);
    expect(repo.lockReglaAbierta).not.toHaveBeenCalled();
  });

  it("rejects an empty tramo list, a null tope before the last, and a negative precio mínimo", async () => {
    await expect(guardar({ precioMinimo: "0", tramos: [] })).rejects.toThrow(/al menos un tramo/);
    await expect(
      guardar({
        precioMinimo: "0",
        tramos: [
          { costoHasta: null, margen: "10" },
          { costoHasta: null, margen: "10" },
        ],
      }),
    ).rejects.toThrow(/Solo el último tramo/);
    await expect(guardar({ ...EJEMPLO, precioMinimo: "-1" })).rejects.toThrow(/Precio mínimo/);
    expect(repo.insertReglaPrecio).not.toHaveBeenCalled();
  });
});
