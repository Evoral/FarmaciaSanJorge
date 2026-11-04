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

const getUnidadesParaCorduraMock = vi.fn().mockResolvedValue(new Map());

vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  buscarRecetaPorEnvio: (...args: unknown[]) => buscarRecetaPorEnvioMock(...args),
  insertRecetaConItems: (...args: unknown[]) => insertRecetaConItemsMock(...args),
  getPacienteRefParaReceta: vi.fn(async () => ({ id: "pac-1", fechaBaja: null })),
  getMedicoRefParaReceta: vi.fn(async () => ({ id: "med-1", fechaBaja: null })),
  jornadaActualTenant: vi.fn(async () => "2026-10-23"),
  clasificarDrogasDeReceta: vi.fn(async () => ({ invalidas: [], principiosActivos: new Set(), materiales: [] })),
  unidadesInvalidas: vi.fn(async () => []),
  getMagnitudesDeUnidades: vi.fn(async () => new Map()),
  getUnidadesParaCordura: (...args: unknown[]) => getUnidadesParaCorduraMock(...args),
  getNombresParaResumen: vi.fn(async () => ({ drogas: new Map(), unidades: new Map() })),
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

  it("crearReceta: refuses with V12 when a concentration component yields more than the total prepared", async () => {
    const { crearRecetaCommand } = await import("@/modules/recetas/application/crear-receta");

    const UNIDAD_G = "66666666-6666-4666-a666-666666666661";
    const UNIDAD_MG = "66666666-6666-4666-a666-666666666662";
    const UNIDAD_ML = "66666666-6666-4666-a666-666666666663";

    buscarRecetaPorEnvioMock.mockResolvedValue(null);
    getUnidadesParaCorduraMock.mockResolvedValue(
      new Map([
        [UNIDAD_G, { tipoMagnitud: "MASA", factorABase: "1", simbolo: "g" }],
        [UNIDAD_MG, { tipoMagnitud: "MASA", factorABase: "0.001", simbolo: "mg" }],
        [UNIDAD_ML, { tipoMagnitud: "VOLUMEN", factorABase: "1", simbolo: "mL" }],
      ]),
    );

    const input = {
      pacienteId: "22222222-2222-4222-a222-222222222222",
      medicoId: "33333333-3333-4333-a333-333333333333",
      fechaPrescripcion: "2026-10-23",
      origen: "PRESENCIAL" as const,
      items: [
        {
          descripcion: "Item 1",
          formaFarmaceutica: "CREMA" as const,
          cantidadUnidades: 1,
          fraccionDosisPorUnidad: "1",
          cantidadTotal: "30",
          unidadTotalId: UNIDAD_G,
          componentes: [
            {
              drogaId: "44444444-4444-4444-a444-444444444444",
              cantidad: "2.3",
              unidadMedidaId: UNIDAD_ML,
              unidadReferenciaId: UNIDAD_MG,
              modoExpresion: "CONCENTRACION" as const,
            },
          ],
        },
      ],
    };

    const session = {
      tenantId: "11111111-1111-4111-8111-111111111111",
      usuario: { id: "99999999-9999-4999-8999-999999999999", email: "dt@test.com", nombre: "DT", apellido: "Test" },
      permisos: new Set(["recetas.crear"]),
    };

    await expect(crearRecetaCommand.execute(input, { session: session as never })).rejects.toThrow(
      "En el ítem 1, el componente 1 (2,3 mL/mg × 30 g) da 69.000 mL: más que todo el preparado. Revisá el valor y el «por».",
    );
  });
});

describe("crearReceta vigencia fechaValidaDesde", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buscarRecetaPorEnvioMock.mockResolvedValue(null);
    insertRecetaConItemsMock.mockResolvedValue({ id: "receta-nueva-123", numeroInterno: "889" });
  });

  it("accepts an old prescription when fechaValidaDesde is inside the window and rejects when outside", async () => {
    const { crearRecetaCommand } = await import("@/modules/recetas/application/crear-receta");

    const session = {
      tenantId: "11111111-1111-4111-a111-111111111111",
      usuario: { id: "user-1", email: "u@fsj.test", roles: ["FARMACEUTICO"] },
      permisos: new Set(["recetas.crear"]),
    };

    const baseInput = {
      pacienteId: "22222222-2222-4222-a222-222222222222",
      medicoId: "33333333-3333-4333-a333-333333333333",
      fechaPrescripcion: "2026-08-01",
      origen: "PRESENCIAL" as const,
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

    // jornadaActualTenant is mocked as 2026-10-23; window starts at 2026-09-23
    await expect(
      crearRecetaCommand.execute({ ...baseInput, fechaValidaDesde: "2026-09-23" }, { session: session as never }),
    ).resolves.toBeDefined();

    await expect(
      crearRecetaCommand.execute({ ...baseInput, fechaValidaDesde: "2026-09-22" }, { session: session as never }),
    ).rejects.toThrow("La fecha de validez no puede tener más de un mes ni ser de un mes próximo.");
  });
});
