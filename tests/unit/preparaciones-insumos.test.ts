/**
 * Unit tests for the "insumos de la preparación" feature (spec openspec/specs/insumos-preparacion/spec.md):
 * - modules/preparaciones/application/guardar-insumos-borrador.ts (I1, I2, I3, I4, I8)
 * - modules/preparaciones/application/insumos-preparacion.ts (I5, I6, I7, I8, I9, I10)
 * - Excipiente & insumos cross-isolation regression (deleteReservasSinLinea / listReservasSinLinea / consumir / replanificar).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dec } from "@/shared/decimal";
import { NotFoundError, ValidationError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { TipoAccion } from "@/generated/prisma/client";

// Mocks for shared infrastructure and auth
const auditRecordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) =>
  fn({ __fakeTx: true }),
);
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

// Mocks for preparacion-repository
const getFichaParaIniciarMock = vi.fn();
const getPreparacionActivaDeFichaMock = vi.fn();
const getExcipienteBorradorMock = vi.fn();
const reemplazarInsumosBorradorMock = vi.fn();
const getDrogaExcipienteMock = vi.fn();
const getExcipienteDePreparacionMock = vi.fn();
const insertInsumosPreparacionMock = vi.fn();
const listInsumosDePreparacionMock = vi.fn();
const listPartidasElegiblesDrogaMock = vi.fn();
const lockPartidasParaConfirmacionMock = vi.fn();
const getPartidasFrescasMock = vi.fn();
const listReservasSinLineaMock = vi.fn();
const insertReservasSinLineaMock = vi.fn();
const deleteReservasSinLineaMock = vi.fn();
const insertEgresoPreparacionMock = vi.fn();
const setExcipienteEstructuradoMock = vi.fn();

const repo = {
  getFichaParaIniciar: (...args: unknown[]) => getFichaParaIniciarMock(...args),
  getPreparacionActivaDeFicha: (...args: unknown[]) => getPreparacionActivaDeFichaMock(...args),
  getExcipienteBorrador: (...args: unknown[]) => getExcipienteBorradorMock(...args),
  reemplazarInsumosBorrador: (...args: unknown[]) => reemplazarInsumosBorradorMock(...args),
  getDrogaExcipiente: (...args: unknown[]) => getDrogaExcipienteMock(...args),
  getExcipienteDePreparacion: (...args: unknown[]) => getExcipienteDePreparacionMock(...args),
  insertInsumosPreparacion: (...args: unknown[]) => insertInsumosPreparacionMock(...args),
  listInsumosDePreparacion: (...args: unknown[]) => listInsumosDePreparacionMock(...args),
  listPartidasElegiblesDroga: (...args: unknown[]) => listPartidasElegiblesDrogaMock(...args),
  lockPartidasParaConfirmacion: (...args: unknown[]) => lockPartidasParaConfirmacionMock(...args),
  getPartidasFrescas: (...args: unknown[]) => getPartidasFrescasMock(...args),
  listReservasSinLinea: (...args: unknown[]) => listReservasSinLineaMock(...args),
  insertReservasSinLinea: (...args: unknown[]) => insertReservasSinLineaMock(...args),
  deleteReservasSinLinea: (...args: unknown[]) => deleteReservasSinLineaMock(...args),
  insertEgresoPreparacion: (...args: unknown[]) => insertEgresoPreparacionMock(...args),
  setExcipienteEstructurado: (...args: unknown[]) => setExcipienteEstructuradoMock(...args),
};

vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", () => repo);

const TENANT_ID = "00000000-0000-4000-a000-000000000001";
const USUARIO_ID = "11111111-1111-4111-a111-111111111111";
const FICHA_ID = "22222222-2222-4222-a222-222222222222";
const PREPARACION_ID = "33333333-3333-4333-a333-333333333333";
const DROGA_MATERIAL_ID = "44444444-4444-4444-a444-444444444444";
const DROGA_EXCIPIENTE_ID = "55555555-5555-4555-a555-555555555555";
const DROGA_ADICIONAL_ID = "66666666-6666-4666-a666-666666666666";
const DROGA_COMUN_ID = "77777777-7777-4777-a777-777777777777";
const JORNADA = "2026-10-29";

function createSession(permisos = ["preparaciones.confirmar", "preparaciones.iniciar"]): AuthenticatedSession {
  return {
    usuario: { id: USUARIO_ID, email: "farmaceutico@example.com", nombre: "Farmacéutico", apellido: "Test" },
    tenantId: TENANT_ID,
    sesionId: "sesion-1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

describe("guardarInsumosBorrador (I1, I2, I3, I4, I8)", () => {
  const session = createSession();

  beforeEach(() => {
    vi.clearAllMocks();
    getFichaParaIniciarMock.mockResolvedValue({ id: FICHA_ID });
    getPreparacionActivaDeFichaMock.mockResolvedValue(null);
    getExcipienteBorradorMock.mockResolvedValue(null);
    reemplazarInsumosBorradorMock.mockResolvedValue([]);
    getDrogaExcipienteMock.mockImplementation(async (_tx, _tenantId, id: string) => {
      if (id === DROGA_MATERIAL_ID) {
        return { id, nombre: "Cápsula vacía Nº 0", clase: "MATERIAL", vigente: true, unidadSimbolo: "u" };
      }
      if (id === DROGA_EXCIPIENTE_ID) {
        return { id, nombre: "Ludipress", clase: "EXCIPIENTE", vigente: true, unidadSimbolo: "g" };
      }
      if (id === DROGA_ADICIONAL_ID) {
        return { id, nombre: "Aerosil", clase: "EXCIPIENTE", vigente: true, unidadSimbolo: "g" };
      }
      if (id === DROGA_COMUN_ID) {
        return { id, nombre: "Ibuprofeno", clase: "DROGA", vigente: true, unidadSimbolo: "g" };
      }
      return null;
    });
  });

  it("Zod validation: rejects more than INSUMOS_MAX (30) items", async () => {
    const { guardarInsumosBorradorCommand, INSUMOS_MAX } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );
    expect(INSUMOS_MAX).toBe(30);

    const excessInsumos = Array.from({ length: 31 }, () => ({
      tipo: "ADICIONAL" as const,
      drogaId: DROGA_ADICIONAL_ID,
      cantidad: "1",
    }));

    await expect(
      guardarInsumosBorradorCommand.execute({ fichaTecnicaId: FICHA_ID, insumos: excessInsumos }, { session }),
    ).rejects.toThrow(ValidationError);
  });

  it("Zod validation: rejects invalid UUIDs and invalid tipo", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );

    await expect(
      guardarInsumosBorradorCommand.execute(
        { fichaTecnicaId: "not-a-uuid", insumos: [] },
        { session },
      ),
    ).rejects.toThrow(ValidationError);

    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "INVALIDO" as never, drogaId: DROGA_ADICIONAL_ID, cantidad: "1" }],
        },
        { session },
      ),
    ).rejects.toThrow(ValidationError);

    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "MATERIAL", drogaId: "not-a-uuid", cantidad: "1" }],
        },
        { session },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses when ficha técnica is not found (NotFoundError)", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );
    getFichaParaIniciarMock.mockResolvedValue(null);

    await expect(
      guardarInsumosBorradorCommand.execute({ fichaTecnicaId: FICHA_ID, insumos: [] }, { session }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses when the ítem already has a live preparación (DomainError)", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );
    getPreparacionActivaDeFichaMock.mockResolvedValue({ id: PREPARACION_ID });

    await expect(
      guardarInsumosBorradorCommand.execute({ fichaTecnicaId: FICHA_ID, insumos: [] }, { session }),
    ).rejects.toThrow("El ítem ya tiene el stock reservado: recargá la página.");
  });

  it("refuses a repeated droga when an insumo repeats the excipiente's droga (I8)", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );
    getExcipienteBorradorMock.mockResolvedValue({ drogaId: DROGA_EXCIPIENTE_ID, cantidad: "10" });

    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "ADICIONAL", drogaId: DROGA_EXCIPIENTE_ID, cantidad: "1" }],
        },
        { session },
      ),
    ).rejects.toThrow("Ludipress ya está elegido como excipiente: no lo cargues también como material o insumo.");
  });

  it("refuses when the same droga appears in two insumo rows (I8)", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );

    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [
            { tipo: "ADICIONAL", drogaId: DROGA_ADICIONAL_ID, cantidad: "1" },
            { tipo: "ADICIONAL", drogaId: DROGA_ADICIONAL_ID, cantidad: "2" },
          ],
        },
        { session },
      ),
    ).rejects.toThrow("Aerosil está cargado dos veces: dejalo en una sola fila con la cantidad total.");
  });

  it("accepts a MATERIAL with a quantity and no droga (the cápsulas pre-fill) and saves it (I2)", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );

    const result = await guardarInsumosBorradorCommand.execute(
      {
        fichaTecnicaId: FICHA_ID,
        insumos: [{ tipo: "MATERIAL", drogaId: null, cantidad: "60" }],
      },
      { session },
    );

    expect(result.insumos).toEqual([{ tipo: "MATERIAL", drogaId: null, cantidad: "60" }]);
    expect(reemplazarInsumosBorradorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fichaTecnicaId: FICHA_ID,
        insumos: [{ tipo: "MATERIAL", drogaId: null, cantidad: "60" }],
      }),
    );
  });

  it("filters out an ADICIONAL row without a droga", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );

    const result = await guardarInsumosBorradorCommand.execute(
      {
        fichaTecnicaId: FICHA_ID,
        insumos: [
          { tipo: "ADICIONAL", drogaId: null, cantidad: "5" },
          { tipo: "ADICIONAL", drogaId: DROGA_ADICIONAL_ID, cantidad: "1" },
        ],
      },
      { session },
    );

    expect(result.insumos).toEqual([{ tipo: "ADICIONAL", drogaId: DROGA_ADICIONAL_ID, cantidad: "1" }]);
  });

  it("enforces clase rules: MATERIAL requires clase MATERIAL; ADICIONAL requires EXCIPIENTE or MATERIAL; never DROGA", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );

    // MATERIAL with clase EXCIPIENTE -> rejected
    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "MATERIAL", drogaId: DROGA_EXCIPIENTE_ID, cantidad: "10" }],
        },
        { session },
      ),
    ).rejects.toThrow("Elegí un material del listado.");

    // MATERIAL with clase DROGA -> rejected
    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "MATERIAL", drogaId: DROGA_COMUN_ID, cantidad: "10" }],
        },
        { session },
      ),
    ).rejects.toThrow("Elegí un material del listado.");

    // ADICIONAL with clase DROGA -> rejected
    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "ADICIONAL", drogaId: DROGA_COMUN_ID, cantidad: "10" }],
        },
        { session },
      ),
    ).rejects.toThrow("Elegí un excipiente o material del listado.");

    // ADICIONAL with clase MATERIAL -> accepted
    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "ADICIONAL", drogaId: DROGA_MATERIAL_ID, cantidad: "10" }],
        },
        { session },
      ),
    ).resolves.toBeDefined();
  });

  it("refuses a droga dada de baja (vigente: false)", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );
    getDrogaExcipienteMock.mockResolvedValueOnce({
      id: DROGA_MATERIAL_ID,
      nombre: "Cápsula obsoleta",
      clase: "MATERIAL",
      vigente: false,
      unidadSimbolo: "u",
    });

    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "MATERIAL", drogaId: DROGA_MATERIAL_ID, cantidad: "60" }],
        },
        { session },
      ),
    ).rejects.toThrow("El material Cápsula obsoleta está dado de baja: elegí otro.");
  });

  it("refuses a quantity less than or equal to 0", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );

    await expect(
      guardarInsumosBorradorCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "MATERIAL", drogaId: DROGA_MATERIAL_ID, cantidad: "0" }],
        },
        { session },
      ),
    ).rejects.toThrow("La cantidad del material Cápsula vacía Nº 0 debe ser mayor que 0.");
  });

  it("writes audit log with MODIFICAR on ficha_tecnica", async () => {
    const { guardarInsumosBorradorCommand } = await import(
      "@/modules/preparaciones/application/guardar-insumos-borrador"
    );
    reemplazarInsumosBorradorMock.mockResolvedValueOnce([
      { tipo: "MATERIAL", drogaId: null, cantidad: "60" },
    ]);

    await guardarInsumosBorradorCommand.execute(
      {
        fichaTecnicaId: FICHA_ID,
        insumos: [{ tipo: "MATERIAL", drogaId: DROGA_MATERIAL_ID, cantidad: "60" }],
      },
      { session },
    );

    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        entidad: "ficha_tecnica",
        accion: TipoAccion.MODIFICAR,
        entidadId: FICHA_ID,
        valorAnterior: { insumosBorrador: [{ tipo: "MATERIAL", drogaId: null, cantidad: "60" }] },
        valorNuevo: { insumosBorrador: [{ tipo: "MATERIAL", drogaId: DROGA_MATERIAL_ID, cantidad: "60" }] },
      }),
    );
  });
});

describe("validarInsumosEnTx (I5, I6, I8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDrogaExcipienteMock.mockImplementation(async (_tx, _tenantId, id: string) => {
      if (id === DROGA_MATERIAL_ID) {
        return { id, nombre: "Cápsula vacía Nº 0", clase: "MATERIAL", vigente: true, unidadSimbolo: "u" };
      }
      if (id === DROGA_ADICIONAL_ID) {
        return { id, nombre: "Aerosil", clase: "EXCIPIENTE", vigente: true, unidadSimbolo: "g" };
      }
      return null;
    });
  });

  it("refuses more than one MATERIAL row", async () => {
    const { validarInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    await expect(
      validarInsumosEnTx(
        fakeTx,
        TENANT_ID,
        [
          { tipo: "MATERIAL", drogaId: DROGA_MATERIAL_ID, cantidad: dec(60) },
          { tipo: "MATERIAL", drogaId: null, cantidad: dec(60) },
        ],
        null,
      ),
    ).rejects.toThrow("Solo se puede cargar un material.");
  });

  it("accepts a MATERIAL row with drogaId null and returns null in that position", async () => {
    const { validarInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    const result = await validarInsumosEnTx(
      fakeTx,
      TENANT_ID,
      [{ tipo: "MATERIAL", drogaId: null, cantidad: dec(60) }],
      null,
    );

    expect(result).toEqual([null]);
  });
});

describe("reservarInsumosEnTx (I6)", () => {
  const session = createSession();

  beforeEach(() => {
    vi.clearAllMocks();
    getExcipienteDePreparacionMock.mockResolvedValue(null);
    getDrogaExcipienteMock.mockImplementation(async (_tx, _tenantId, id: string) => {
      if (id === DROGA_MATERIAL_ID) {
        return { id, nombre: "Cápsula vacía Nº 0", clase: "MATERIAL", vigente: true, unidadSimbolo: "u" };
      }
      if (id === DROGA_ADICIONAL_ID) {
        return { id, nombre: "Aerosil", clase: "EXCIPIENTE", vigente: true, unidadSimbolo: "g" };
      }
      return null;
    });
    lockPartidasParaConfirmacionMock.mockImplementation(async (_tx, _tenantId, ids: string[]) => ids);
    insertInsumosPreparacionMock.mockResolvedValue(undefined);
    insertReservasSinLineaMock.mockResolvedValue(undefined);
  });

  it("returns empty array when insumos list is empty", async () => {
    const { reservarInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    const result = await reservarInsumosEnTx(fakeTx, session, {
      preparacionId: PREPARACION_ID,
      insumos: [],
      jornada: JORNADA,
    });

    expect(result).toEqual([]);
    expect(insertInsumosPreparacionMock).not.toHaveBeenCalled();
    expect(insertReservasSinLineaMock).not.toHaveBeenCalled();
  });

  it("orders MATERIAL first, records insertInsumosPreparacion with formatted text, and reserves oldest lot first", async () => {
    const { reservarInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    // Insumos passed with ADICIONAL first, then MATERIAL
    const insumos = [
      { tipo: "ADICIONAL" as const, drogaId: DROGA_ADICIONAL_ID, cantidad: dec("0.5") },
      { tipo: "MATERIAL" as const, drogaId: DROGA_MATERIAL_ID, cantidad: dec("60") },
    ];

    // For Material: 2 candidate partidas
    // P1: cerrada, expires earlier (2027-01-01), stock 100
    // P2: abierta (fechaApertura set), expires later (2027-06-01), stock 40
    // Because P2 is abierta, it MUST be consumed first (40 units), then P1 (20 units)!
    const P1_CERRADA = "p1-cerrada";
    const P2_ABIERTA = "p2-abierta";
    const P3_ADICIONAL = "p3-adicional";

    listPartidasElegiblesDrogaMock.mockImplementation(async (_tx, _tenantId, drogaId: string) => {
      if (drogaId === DROGA_MATERIAL_ID) {
        return [{ id: P1_CERRADA }, { id: P2_ABIERTA }];
      }
      if (drogaId === DROGA_ADICIONAL_ID) {
        return [{ id: P3_ADICIONAL }];
      }
      return [];
    });

    getPartidasFrescasMock.mockImplementation(async (_tx, _tenantId, ids: string[]) => {
      const all = [
        {
          id: P1_CERRADA,
          drogaId: DROGA_MATERIAL_ID,
          lote: "L-MAT-1",
          cantidadDisponible: "100",
          fechaVencimiento: "2027-01-01",
          fechaApertura: null,
          purezaDeclaradaPorcentaje: "90", // purity MUST be ignored (physical reservation)
        },
        {
          id: P2_ABIERTA,
          drogaId: DROGA_MATERIAL_ID,
          lote: "L-MAT-2",
          cantidadDisponible: "40",
          fechaVencimiento: "2027-06-01",
          fechaApertura: "2026-01-01",
          purezaDeclaradaPorcentaje: null,
        },
        {
          id: P3_ADICIONAL,
          drogaId: DROGA_ADICIONAL_ID,
          lote: "L-ADI-1",
          cantidadDisponible: "10",
          fechaVencimiento: "2027-01-01",
          fechaApertura: null,
          purezaDeclaradaPorcentaje: null,
        },
      ];
      return all.filter((p) => ids.includes(p.id));
    });

    const result = await reservarInsumosEnTx(fakeTx, session, {
      preparacionId: PREPARACION_ID,
      insumos,
      jornada: JORNADA,
    });

    // Verify insertInsumosPreparacion was called with MATERIAL sorted first
    expect(insertInsumosPreparacionMock).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        preparacionId: PREPARACION_ID,
        insumos: [
          {
            tipo: "MATERIAL",
            drogaId: DROGA_MATERIAL_ID,
            cantidad: "60",
            texto: "Cápsula vacía Nº 0 60 u",
          },
          {
            tipo: "ADICIONAL",
            drogaId: DROGA_ADICIONAL_ID,
            cantidad: "0.5",
            texto: "Aerosil 0,5 g",
          },
        ],
      }),
    );

    // Verify MATERIAL reservation picked abierta first (40 from P2_ABIERTA, 20 from P1_CERRADA)
    const materialResumen = result.find((r) => r.tipo === "MATERIAL");
    expect(materialResumen).toBeDefined();
    expect(materialResumen?.partidas).toEqual([
      { partidaId: P2_ABIERTA, cantidad: "40" },
      { partidaId: P1_CERRADA, cantidad: "20" },
    ]);

    // Verify insertReservasSinLinea was called for both insumos with session user
    expect(insertReservasSinLineaMock).toHaveBeenCalledTimes(2);
    expect(insertReservasSinLineaMock).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        preparacionId: PREPARACION_ID,
        reservadaPorId: USUARIO_ID,
      }),
    );
  });

  it("refuses with shortfall details when stock of an insumo is insufficient", async () => {
    const { reservarInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    listPartidasElegiblesDrogaMock.mockResolvedValueOnce([{ id: "p-short" }]);
    getPartidasFrescasMock.mockResolvedValueOnce([
      {
        id: "p-short",
        drogaId: DROGA_MATERIAL_ID,
        lote: "L-1",
        cantidadDisponible: "30",
        fechaVencimiento: "2027-01-01",
        fechaApertura: null,
        purezaDeclaradaPorcentaje: null,
      },
    ]);

    await expect(
      reservarInsumosEnTx(fakeTx, session, {
        preparacionId: PREPARACION_ID,
        insumos: [{ tipo: "MATERIAL", drogaId: DROGA_MATERIAL_ID, cantidad: dec("60") }],
        jornada: JORNADA,
      }),
    ).rejects.toThrow("Stock insuficiente del material Cápsula vacía Nº 0: faltan 30 u. Ingresá stock del material o elegí otro.");

    // insertReservasSinLinea must NOT have been called
    expect(insertReservasSinLineaMock).not.toHaveBeenCalled();
  });
});

describe("replanificarInsumosEnTx and guardarReservaInsumosEnTx (I7)", () => {
  const session = createSession();

  beforeEach(() => {
    vi.clearAllMocks();
    lockPartidasParaConfirmacionMock.mockImplementation(async (_tx, _tenantId, ids: string[]) => ids);
    deleteReservasSinLineaMock.mockResolvedValue(undefined);
    insertReservasSinLineaMock.mockResolvedValue(undefined);
  });

  it("re-plans without deleting reservas, and leaves previous reservas untouched on shortfall", async () => {
    const { replanificarInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    listInsumosDePreparacionMock.mockResolvedValueOnce([
      {
        tipo: "MATERIAL",
        drogaId: DROGA_MATERIAL_ID,
        drogaNombre: "Cápsula vacía Nº 0",
        clase: "MATERIAL",
        cantidad: "60",
        unidadSimbolo: "u",
        texto: "Cápsula vacía Nº 0 60 u",
      },
    ]);

    // Shortfall: only 20 available
    listPartidasElegiblesDrogaMock.mockResolvedValueOnce([{ id: "p1" }]);
    getPartidasFrescasMock.mockResolvedValueOnce([
      {
        id: "p1",
        drogaId: DROGA_MATERIAL_ID,
        lote: "L-1",
        cantidadDisponible: "20",
        fechaVencimiento: "2027-01-01",
        fechaApertura: null,
        purezaDeclaradaPorcentaje: null,
      },
    ]);

    await expect(
      replanificarInsumosEnTx(fakeTx, session, { preparacionId: PREPARACION_ID, jornada: JORNADA }),
    ).rejects.toThrow("Stock insuficiente del material Cápsula vacía Nº 0: faltan 40 u. Liberá la reserva y elegí otro material, o ingresá stock.");

    // Critical invariant: deleteReservasSinLinea must NOT be called on failure
    expect(deleteReservasSinLineaMock).not.toHaveBeenCalled();
  });

  it("guardarReservaInsumosEnTx drops only the specific insumo's reservas by drogaId and inserts new ones", async () => {
    const { guardarReservaInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    const resumenes = [
      {
        tipo: "MATERIAL" as const,
        drogaId: DROGA_MATERIAL_ID,
        droga: "Cápsula vacía Nº 0",
        cantidad: "60 u",
        partidas: [{ partidaId: "p-mat-new", cantidad: "60" }],
      },
      {
        tipo: "ADICIONAL" as const,
        drogaId: DROGA_ADICIONAL_ID,
        droga: "Aerosil",
        cantidad: "0.5 g",
        partidas: [{ partidaId: "p-adi-new", cantidad: "0.5" }],
      },
    ];

    await guardarReservaInsumosEnTx(fakeTx, session, PREPARACION_ID, resumenes);

    // It must delete reservas per drogaId
    expect(deleteReservasSinLineaMock).toHaveBeenCalledTimes(2);
    expect(deleteReservasSinLineaMock).toHaveBeenNthCalledWith(1, fakeTx, TENANT_ID, PREPARACION_ID, DROGA_MATERIAL_ID);
    expect(deleteReservasSinLineaMock).toHaveBeenNthCalledWith(2, fakeTx, TENANT_ID, PREPARACION_ID, DROGA_ADICIONAL_ID);

    // It must insert new reservas
    expect(insertReservasSinLineaMock).toHaveBeenCalledTimes(2);
    expect(insertReservasSinLineaMock).toHaveBeenNthCalledWith(
      1,
      fakeTx,
      expect.objectContaining({
        preparacionId: PREPARACION_ID,
        partes: [{ partidaId: "p-mat-new", cantidad: "60" }],
      }),
    );
  });
});

describe("consumirInsumosEnTx (I9, I10)", () => {
  const session = createSession();

  beforeEach(() => {
    vi.clearAllMocks();
    lockPartidasParaConfirmacionMock.mockImplementation(async (_tx, _tenantId, ids: string[]) => ids);
    insertEgresoPreparacionMock.mockResolvedValue(undefined);
  });

  it("refuses if an insumo has no stock reserved", async () => {
    const { consumirInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    listInsumosDePreparacionMock.mockResolvedValueOnce([
      {
        tipo: "MATERIAL",
        drogaId: DROGA_MATERIAL_ID,
        drogaNombre: "Cápsula vacía Nº 0",
        clase: "MATERIAL",
        cantidad: "60",
        unidadSimbolo: "u",
        texto: "Cápsula vacía Nº 0 60 u",
      },
    ]);
    listReservasSinLineaMock.mockResolvedValueOnce([]); // no reserved stock

    await expect(
      consumirInsumosEnTx(fakeTx, session, { preparacionId: PREPARACION_ID, jornada: JORNADA }),
    ).rejects.toThrow("No hay stock reservado del material Cápsula vacía Nº 0: recalculá la reserva.");
  });

  it("consumes only the reserved partidas with linea_pesaje_id null and never contralor", async () => {
    const { consumirInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    listInsumosDePreparacionMock.mockResolvedValueOnce([
      {
        tipo: "MATERIAL",
        drogaId: DROGA_MATERIAL_ID,
        drogaNombre: "Cápsula vacía Nº 0",
        clase: "MATERIAL",
        cantidad: "60",
        unidadSimbolo: "u",
        texto: "Cápsula vacía Nº 0 60 u",
      },
    ]);

    const RESERVED_PARTIDA = "p-reserved-mat";
    listReservasSinLineaMock.mockResolvedValueOnce([
      { partidaId: RESERVED_PARTIDA, drogaId: DROGA_MATERIAL_ID, cantidad: "60" },
    ]);

    getPartidasFrescasMock.mockResolvedValueOnce([
      {
        id: RESERVED_PARTIDA,
        drogaId: DROGA_MATERIAL_ID,
        lote: "L-RES-1",
        cantidadDisponible: "60",
        fechaVencimiento: "2027-01-01",
        fechaApertura: null,
        purezaDeclaradaPorcentaje: null,
      },
    ]);

    await consumirInsumosEnTx(fakeTx, session, { preparacionId: PREPARACION_ID, jornada: JORNADA });

    expect(insertEgresoPreparacionMock).toHaveBeenCalledTimes(1);
    expect(insertEgresoPreparacionMock).toHaveBeenCalledWith(fakeTx, {
      tenantId: TENANT_ID,
      partidaId: RESERVED_PARTIDA,
      cantidad: "60",
      preparacionId: PREPARACION_ID,
      lineaPesajeId: null,
      registradoPorId: USUARIO_ID,
      desvioPropuesta: false,
      potenciaAplicada: null,
    });
  });
});

describe("partidasCandidatasInsumosEnTx", () => {
  it("collects eligible candidate partidas for given or stored insumo drogas", async () => {
    const { partidasCandidatasInsumosEnTx } = await import("@/modules/preparaciones/application/insumos-preparacion");
    const fakeTx = {} as never;

    listPartidasElegiblesDrogaMock.mockImplementation(async (_tx, _tenantId, drogaId: string) => {
      if (drogaId === "d1") return [{ id: "p1" }, { id: "p2" }];
      if (drogaId === "d2") return [{ id: "p3" }];
      return [];
    });

    const ids = await partidasCandidatasInsumosEnTx(fakeTx, TENANT_ID, {
      preparacionId: PREPARACION_ID,
      drogaIds: ["d1", "d2"],
    });

    expect(ids).toEqual(["p1", "p2", "p3"]);
  });
});

describe("excipiente & insumos cross-isolation regression", () => {
  const session = createSession();

  it("repository implementation: listReservasSinLinea and deleteReservasSinLinea filter strictly by drogaId", async () => {
    const actualRepo = await vi.importActual<typeof import("@/modules/preparaciones/infrastructure/preparacion-repository")>(
      "@/modules/preparaciones/infrastructure/preparacion-repository",
    );

    const deleteManyMock = vi.fn(async (...args: unknown[]) => {
      void args;
      return { count: 1 };
    });
    const fakeTx = {
      $queryRaw: vi.fn(async (...args: unknown[]) => {
        void args;
        return [
          { partida_id: "p-excipiente", droga_id: DROGA_EXCIPIENTE_ID, cantidad: "10" },
          { partida_id: "p-insumo-material", droga_id: DROGA_MATERIAL_ID, cantidad: "60" },
          { partida_id: "p-insumo-adicional", droga_id: DROGA_ADICIONAL_ID, cantidad: "0.5" },
        ];
      }),
      reservaStock: {
        deleteMany: deleteManyMock,
      },
    } as unknown as Parameters<typeof actualRepo.listReservasSinLinea>[0];

    // 1. Without drogaId: returns all line-less reservas
    const all = await actualRepo.listReservasSinLinea(fakeTx, TENANT_ID, PREPARACION_ID);
    expect(all).toHaveLength(3);

    // 2. With excipiente drogaId: returns only excipiente partida
    const onlyExcipiente = await actualRepo.listReservasSinLinea(fakeTx, TENANT_ID, PREPARACION_ID, DROGA_EXCIPIENTE_ID);
    expect(onlyExcipiente).toEqual([{ partidaId: "p-excipiente", drogaId: DROGA_EXCIPIENTE_ID, cantidad: "10" }]);

    // 3. With material drogaId: returns only material partida
    const onlyMaterial = await actualRepo.listReservasSinLinea(fakeTx, TENANT_ID, PREPARACION_ID, DROGA_MATERIAL_ID);
    expect(onlyMaterial).toEqual([{ partidaId: "p-insumo-material", drogaId: DROGA_MATERIAL_ID, cantidad: "60" }]);

    // 4. deleteReservasSinLinea for excipiente only deletes p-excipiente, NOT insumos!
    await actualRepo.deleteReservasSinLinea(fakeTx, TENANT_ID, PREPARACION_ID, DROGA_EXCIPIENTE_ID);
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        preparacionId: PREPARACION_ID,
        lineaPesajeId: null,
        partidaId: { in: ["p-excipiente"] },
      },
    });

    // 5. deleteReservasSinLinea for material only deletes p-insumo-material
    deleteManyMock.mockClear();
    await actualRepo.deleteReservasSinLinea(fakeTx, TENANT_ID, PREPARACION_ID, DROGA_MATERIAL_ID);
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        preparacionId: PREPARACION_ID,
        lineaPesajeId: null,
        partidaId: { in: ["p-insumo-material"] },
      },
    });
  });

  it("application: consumirExcipienteEnTx queries listReservasSinLinea only for excipiente.drogaId", async () => {
    const { consumirExcipienteEnTx } = await import("@/modules/preparaciones/application/excipiente-preparacion");
    const fakeTx = {} as never;

    getExcipienteDePreparacionMock.mockResolvedValueOnce({
      drogaId: DROGA_EXCIPIENTE_ID,
      drogaNombre: "Ludipress",
      cantidad: "10",
      unidadSimbolo: "g",
    });

    listReservasSinLineaMock.mockResolvedValueOnce([
      { partidaId: "p-excipiente", drogaId: DROGA_EXCIPIENTE_ID, cantidad: "10" },
    ]);

    getPartidasFrescasMock.mockResolvedValueOnce([
      {
        id: "p-excipiente",
        drogaId: DROGA_EXCIPIENTE_ID,
        lote: "L-EXC-1",
        cantidadDisponible: "10",
        fechaVencimiento: "2027-01-01",
        fechaApertura: null,
        purezaDeclaradaPorcentaje: null,
      },
    ]);

    await consumirExcipienteEnTx(fakeTx, session, { preparacionId: PREPARACION_ID, jornada: JORNADA });

    // It must filter by excipiente.drogaId
    expect(listReservasSinLineaMock).toHaveBeenCalledWith(fakeTx, TENANT_ID, PREPARACION_ID, DROGA_EXCIPIENTE_ID);
    expect(insertEgresoPreparacionMock).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({ partidaId: "p-excipiente" }),
    );
  });

  it("application: guardarReservaExcipienteEnTx deletes only the excipiente's reservas by drogaId", async () => {
    const { guardarReservaExcipienteEnTx } = await import("@/modules/preparaciones/application/excipiente-preparacion");
    const fakeTx = {} as never;

    getExcipienteDePreparacionMock.mockResolvedValueOnce({
      drogaId: DROGA_EXCIPIENTE_ID,
      drogaNombre: "Ludipress",
      cantidad: "10",
      unidadSimbolo: "g",
    });

    await guardarReservaExcipienteEnTx(fakeTx, session, PREPARACION_ID, {
      droga: "Ludipress",
      cantidad: "10 g",
      partidas: [{ partidaId: "p-exc-new", cantidad: "10" }],
    });

    expect(deleteReservasSinLineaMock).toHaveBeenCalledWith(fakeTx, TENANT_ID, PREPARACION_ID, DROGA_EXCIPIENTE_ID);
    expect(insertReservasSinLineaMock).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({
        partes: [{ partidaId: "p-exc-new", cantidad: "10" }],
      }),
    );
  });
});

describe("reservarStock input: droga chosen without quantity (I5)", () => {
  const session = createSession();

  it("refuses when an insumo has a droga chosen but missing or invalid quantity", async () => {
    const { reservarStockPreparacionCommand } = await import(
      "@/modules/preparaciones/application/reservar-stock-preparacion"
    );

    // Missing cantidad
    await expect(
      reservarStockPreparacionCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "MATERIAL", drogaId: DROGA_MATERIAL_ID } as never],
        },
        { session },
      ),
    ).rejects.toThrow(ValidationError);

    // Empty string cantidad
    await expect(
      reservarStockPreparacionCommand.execute(
        {
          fichaTecnicaId: FICHA_ID,
          insumos: [{ tipo: "MATERIAL", drogaId: DROGA_MATERIAL_ID, cantidad: "" }],
        },
        { session },
      ),
    ).rejects.toThrow(ValidationError);
  });
});
