import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ValidationError } from "@/shared/errors";
import type { Permiso } from "@/modules/auth/domain/permisos";
import {
  TONOS_FONDO_ROJO,
  colorFondoEtiqueta,
  esTonoFondoRojoValido,
  type FondoEtiquetaConfig,
} from "@/modules/etiqueta-tamanos/domain/etiqueta-fondo";

const recordMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => recordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId })),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called");
  }),
  requireRecentReauth: vi.fn(),
}));

const lockEtiquetaHojaMock = vi.fn(async (..._args: unknown[]) => undefined);
const getFondoEtiquetaMock = vi.fn(async (..._args: unknown[]): Promise<FondoEtiquetaConfig> => ({
  formasFondoRojo: [],
  tonoFondoRojo: "pastel",
}));
const upsertFondoEtiquetaMock = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("@/modules/etiqueta-tamanos/infrastructure/etiqueta-hoja-repository", () => ({
  lockEtiquetaHoja: (...args: unknown[]) => lockEtiquetaHojaMock(...args),
  getFondoEtiqueta: (...args: unknown[]) => getFondoEtiquetaMock(...args),
  upsertFondoEtiqueta: (...args: unknown[]) => upsertFondoEtiquetaMock(...args),
}));

const { editarFondoEtiquetaCommand } = await import("@/modules/etiqueta-tamanos/application/editar-fondo-etiqueta");

const SESSION: AuthenticatedSession = {
  usuario: { id: "u-1", email: "admin@example.com", nombre: "A", apellido: "D" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s-1",
  permisos: new Set(["config.editar"] as Permiso[]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

beforeEach(() => {
  lockEtiquetaHojaMock.mockClear();
  getFondoEtiquetaMock.mockReset().mockResolvedValue({ formasFondoRojo: [], tonoFondoRojo: "pastel" });
  upsertFondoEtiquetaMock.mockClear();
  recordMock.mockClear();
});

describe("etiqueta-fondo domain rules (7327ef6)", () => {
  it("resolves the configured tone hex only for formas in formasFondoRojo", () => {
    const config: FondoEtiquetaConfig = { formasFondoRojo: ["CREMA", "GEL"], tonoFondoRojo: "medio" };

    expect(colorFondoEtiqueta("CREMA", config)).toBe("#f87171");
    expect(colorFondoEtiqueta("GEL", config)).toBe("#f87171");
    expect(colorFondoEtiqueta("CAPSULA", config)).toBeNull();
    expect(colorFondoEtiqueta(null, config)).toBeNull();
    expect(colorFondoEtiqueta(undefined, config)).toBeNull();
    expect(colorFondoEtiqueta("", config)).toBeNull();
    expect(colorFondoEtiqueta("CREMA", null)).toBeNull();
  });

  it("validates the 5 red tones and falls back to the first tone if unknown", () => {
    expect(TONOS_FONDO_ROJO).toHaveLength(5);
    for (const tono of TONOS_FONDO_ROJO) {
      expect(esTonoFondoRojoValido(tono.key)).toBe(true);
    }
    expect(esTonoFondoRojoValido("oscuro")).toBe(false);

    const badConfig = { formasFondoRojo: ["CREMA"], tonoFondoRojo: "inexistente" } as unknown as FondoEtiquetaConfig;
    expect(colorFondoEtiqueta("CREMA", badConfig)).toBe(TONOS_FONDO_ROJO[0].hex);
  });
});

describe("editarFondoEtiqueta validation and execution (7327ef6)", () => {
  it("deduplicates formasFondoRojo, locks before reading, upserts, and audits", async () => {
    const res = await editarFondoEtiquetaCommand.execute(
      { formasFondoRojo: ["CREMA", "GEL", "CREMA"], tonoFondoRojo: "intenso" },
      { session: SESSION },
    );

    expect(res).toEqual({ formasFondoRojo: ["CREMA", "GEL"], tonoFondoRojo: "intenso" });
    expect(lockEtiquetaHojaMock).toHaveBeenCalledTimes(1);
    expect(upsertFondoEtiquetaMock).toHaveBeenCalledWith(expect.anything(), SESSION.tenantId, {
      formasFondoRojo: ["CREMA", "GEL"],
      tonoFondoRojo: "intenso",
    });
    expect(recordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entidad: "etiqueta_hoja",
        entidadId: SESSION.tenantId,
        valorAnterior: { formasFondoRojo: [], tonoFondoRojo: "pastel" },
        valorNuevo: { formasFondoRojo: ["CREMA", "GEL"], tonoFondoRojo: "intenso" },
      }),
    );
  });

  it("rejects invalid forma, invalid tonoFondoRojo, or extra keys", async () => {
    await expect(
      editarFondoEtiquetaCommand.execute({ formasFondoRojo: ["INEXISTENTE"], tonoFondoRojo: "pastel" }, { session: SESSION }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      editarFondoEtiquetaCommand.execute({ formasFondoRojo: ["CREMA"], tonoFondoRojo: "negro" }, { session: SESSION }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      editarFondoEtiquetaCommand.execute({ formasFondoRojo: [], tonoFondoRojo: "pastel", extra: true } as never, { session: SESSION }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
