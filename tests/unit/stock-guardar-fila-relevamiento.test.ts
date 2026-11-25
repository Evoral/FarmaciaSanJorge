import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import type { Permiso } from "@/modules/auth/domain/permisos";
import { ValidationError } from "@/shared/errors";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: { CREAR: "CREAR", MODIFICAR: "MODIFICAR", ELIMINAR: "ELIMINAR" },
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

vi.mock("@/modules/stock/infrastructure/existencia-inicial-repository", () => ({
  lockTenantRelevamientoCompartido: vi.fn(async () => undefined),
  relevamientoInicialAbierto: vi.fn(async () => true),
}));

const upsertFilaRelevamientoMock = vi.fn(async (_tx: unknown, input: { id: string }) => ({
  id: input.id,
  drogaId: null,
  lote: null,
  cantidad: null,
  unidadMedidaId: null,
  proveedorId: null,
}));
vi.mock("@/modules/stock/infrastructure/relevamiento-fila-repository", () => ({
  upsertFilaRelevamiento: upsertFilaRelevamientoMock,
}));

const getDrogaParaIngresoMock = vi.fn();
vi.mock("@/modules/stock/infrastructure/partida-repository", () => ({
  getDrogaParaIngreso: getDrogaParaIngresoMock,
}));

const { guardarFilaRelevamientoCommand } = await import("@/modules/stock/application/guardar-fila-relevamiento");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const FILA_ID = "22222222-2222-4222-a222-222222222222";
const DROGA_ID = "33333333-3333-4333-a333-333333333333";

const SESSION: AuthenticatedSession = {
  usuario: { id: "u-1", email: "far@example.com", nombre: "Nombre", apellido: "Apellido" },
  tenantId: TENANT_ID,
  sesionId: "s-1",
  permisos: new Set(["stock.relevamiento.editar"] as Permiso[]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("guardarFilaRelevamiento -- se_dosifica_en_ui", () => {
  it("accepts a draft row of a se_dosifica_en_ui droga when both potenciaDeclarada and actividadDeclarada are empty", async () => {
    getDrogaParaIngresoMock.mockResolvedValueOnce({
      id: DROGA_ID,
      nombre: "Vitamina D3",
      unidadBaseId: "u-g",
      tipoControl: "NINGUNO",
      clase: "DROGA",
      seDosificaEnUi: true,
      fechaBaja: null,
    });

    await guardarFilaRelevamientoCommand.execute(
      { id: FILA_ID, drogaId: DROGA_ID, potenciaDeclarada: null, actividadDeclarada: null },
      { session: SESSION },
    );

    expect(upsertFilaRelevamientoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: FILA_ID,
        drogaId: DROGA_ID,
        potenciaDeclarada: null,
        actividadDeclarada: null,
      }),
    );
  });

  it("accepts potenciaDeclarada = 100 as explicit gram lot for a se_dosifica_en_ui droga", async () => {
    getDrogaParaIngresoMock.mockResolvedValueOnce({
      id: DROGA_ID,
      nombre: "Vitamina D3",
      unidadBaseId: "u-g",
      tipoControl: "NINGUNO",
      clase: "DROGA",
      seDosificaEnUi: true,
      fechaBaja: null,
    });

    await guardarFilaRelevamientoCommand.execute(
      { id: FILA_ID, drogaId: DROGA_ID, potenciaDeclarada: "100", actividadDeclarada: null },
      { session: SESSION },
    );

    expect(upsertFilaRelevamientoMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: FILA_ID,
        drogaId: DROGA_ID,
      }),
    );
  });

  it("accepts actividadDeclarada for a se_dosifica_en_ui droga", async () => {
    getDrogaParaIngresoMock.mockResolvedValueOnce({
      id: DROGA_ID,
      nombre: "Vitamina D3",
      unidadBaseId: "u-g",
      tipoControl: "NINGUNO",
      clase: "DROGA",
      seDosificaEnUi: true,
      fechaBaja: null,
    });

    await guardarFilaRelevamientoCommand.execute(
      { id: FILA_ID, drogaId: DROGA_ID, potenciaDeclarada: null, actividadDeclarada: "1000 U.I. cada 10 g" },
      { session: SESSION },
    );

    expect(upsertFilaRelevamientoMock).toHaveBeenCalledTimes(1);
  });

  it("leaves unmarked drogas unchanged when both are empty, and refuses actividadDeclarada on them", async () => {
    getDrogaParaIngresoMock.mockResolvedValue({
      id: DROGA_ID,
      nombre: "Paracetamol",
      unidadBaseId: "u-g",
      tipoControl: "NINGUNO",
      clase: "DROGA",
      seDosificaEnUi: false,
      fechaBaja: null,
    });

    await guardarFilaRelevamientoCommand.execute(
      { id: FILA_ID, drogaId: DROGA_ID, potenciaDeclarada: null, actividadDeclarada: null },
      { session: SESSION },
    );
    expect(upsertFilaRelevamientoMock).toHaveBeenCalledTimes(1);

    await expect(
      guardarFilaRelevamientoCommand.execute(
        { id: FILA_ID, drogaId: DROGA_ID, potenciaDeclarada: null, actividadDeclarada: "100" },
        { session: SESSION },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
