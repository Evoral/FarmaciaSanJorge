/**
 * T3-09 regression tests: Idempotent manual receta registration (openspec/specs/alta-receta-idempotente/spec.md).
 *
 * Audit finding T3-09:
 * - `crearReceta` with an already-used `envioId` throws `RecetaYaRegistradaError` with the existing receta
 *   and performs no database insert.
 * - `editarReceta` does NOT accept `envioId` in its schema (`crearRecetaInput.omit({ envioId: true })`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { z } from "zod";
import { RecetaYaRegistradaError, crearRecetaInput } from "@/modules/recetas/application/crear-receta";
import type { EditarRecetaInput } from "@/modules/recetas/application/editar-receta";
import { listRegisteredUseCasesForTests } from "@/shared/usecase";

const buscarRecetaPorEnvioMock = vi.fn();
const insertRecetaConItemsMock = vi.fn();

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const FAKE_TX = { __fakeTx: true };
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn(FAKE_TX),
}));

vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  buscarRecetaPorEnvio: (...args: unknown[]) => buscarRecetaPorEnvioMock(...args),
  insertRecetaConItems: (...args: unknown[]) => insertRecetaConItemsMock(...args),
  getPacienteRefParaReceta: vi.fn(async () => ({ id: "pac-1", fechaBaja: null })),
  getMedicoRefParaReceta: vi.fn(async () => ({ id: "med-1", fechaBaja: null })),
  jornadaActualTenant: vi.fn(async () => "2026-10-23"),
  clasificarDrogasDeReceta: vi.fn(async () => new Map()),
  unidadesInvalidas: vi.fn(async () => []),
  getNombresParaResumen: vi.fn(async () => ({ paciente: "P", medico: "M" })),
}));

describe("T3-09: editarReceta input schema", () => {
  it("crearRecetaInput accepts envioId but editarReceta does not accept envioId in its schema or type", async () => {
    await import("@/modules/recetas/application/editar-receta");

    expect("envioId" in crearRecetaInput.shape).toBe(true);

    // Static type check: EditarRecetaInput must not have envioId
    type HasEnvioId = "envioId" extends keyof EditarRecetaInput ? true : false;
    const hasEnvioIdKey: HasEnvioId = false;
    expect(hasEnvioIdKey).toBe(false);

    // Runtime registered use case check
    const editarEntry = listRegisteredUseCasesForTests().find((u) => u.name === "recetas.editar");
    expect(editarEntry).toBeDefined();
    const shape = (editarEntry!.input as z.ZodObject<z.ZodRawShape>).shape;
    expect("envioId" in shape).toBe(false);
  });
});

describe("T3-09: crearReceta with already-used envioId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws RecetaYaRegistradaError with existing receta and does NOT insert", async () => {
    const { crearRecetaCommand } = await import("@/modules/recetas/application/crear-receta");

    const ENVIO_ID = "66666666-6666-4666-a666-666666666666";
    buscarRecetaPorEnvioMock.mockResolvedValueOnce({
      id: "receta-existing-123",
      numeroInterno: "888",
    });

    const session = {
      tenantId: "11111111-1111-4111-a111-111111111111",
      usuario: { id: "user-1", email: "u@fsj.test", roles: ["FARMACEUTICO"] },
      permisos: new Set(["recetas.crear"]),
    };

    const input = {
      pacienteId: "22222222-2222-4222-a222-222222222222",
      medicoId: "33333333-3333-4333-a333-333333333333",
      fechaPrescripcion: "2026-10-23",
      origen: "PRESENCIAL" as const,
      envioId: ENVIO_ID,
      items: [
        {
          descripcion: "Item 1",
          formaFarmaceutica: "CAPSULA" as const,
          cantidadUnidades: 30,
          fraccionDosisPorUnidad: "1",
          cantidadTotal: null,
          unidadTotalId: null,
          componentes: [
            {
              drogaId: "44444444-4444-4444-a444-444444444444",
              cantidad: "100",
              unidadMedidaId: "55555555-5555-4555-a555-555555555555",
              modoExpresion: "POR_DOSIS" as const,
            },
          ],
        },
      ],
    };

    let caughtError: unknown;
    try {
      await crearRecetaCommand.execute(input, { session: session as never });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(RecetaYaRegistradaError);
    expect((caughtError as RecetaYaRegistradaError).receta).toEqual({
      id: "receta-existing-123",
      numeroInterno: "888",
    });
    expect(buscarRecetaPorEnvioMock).toHaveBeenCalledWith(FAKE_TX, session.tenantId, ENVIO_ID);
    expect(insertRecetaConItemsMock).not.toHaveBeenCalled();
  });
});
