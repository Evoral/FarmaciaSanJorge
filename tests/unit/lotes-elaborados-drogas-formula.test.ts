/**
 * Unit tests for `aplicarFormulaEnTx`, `crearDrogaCommand` and `editarDrogaCommand`
 * (openspec/changes/lotes-elaborados, EL3, INV-EL5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dec } from "@/shared/decimal";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError } from "@/shared/errors";
import type { FormulaLeida } from "@/modules/drogas/infrastructure/formula-repository";

const {
  TENANT_ID,
  USUARIO_ID,
  callOrder,
  auditRecordMock,
  withTenantTransactionMock,
  lockDrogaParaFormulaMock,
  getFormulasDeDrogasMock,
  formulaUsadaEnElaboracionMock,
  eliminarFormulaMock,
  getDrogasParaFormulaMock,
  drogasConFormulaMock,
  formulasQueUsanMock,
  guardarFormulaMock,
  // droga repo
  insertDrogaMock,
  updateDrogaDatosMock,
  getDrogaParaAccionMock,
  lockDrogaParaAccionMock,
  existeNombreVigenteMock,
  tieneAlgunaPartidaMock,
  getEtiquetasUnidadesMock,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  const TENANT_ID = "11111111-1111-4111-8111-111111111111";
  const USUARIO_ID = "99999999-9999-4999-8999-999999999999";
  const UNIDAD_ID = "44444444-4444-4444-8444-444444444444";

  return {
    TENANT_ID,
    USUARIO_ID,
    callOrder,
    auditRecordMock: vi.fn(async () => undefined),
    withTenantTransactionMock: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({
        __fakeTx: true,
        tenantId: TENANT_ID,
        unidadMedida: {
          findUnique: vi.fn(async () => ({ id: UNIDAD_ID, nombre: "Gramo", simbolo: "g", fechaBaja: null })),
        },
      }),
    ),
    lockDrogaParaFormulaMock: vi.fn(),
    getFormulasDeDrogasMock: vi.fn(),
    formulaUsadaEnElaboracionMock: vi.fn(),
    eliminarFormulaMock: vi.fn(),
    getDrogasParaFormulaMock: vi.fn(),
    drogasConFormulaMock: vi.fn(),
    formulasQueUsanMock: vi.fn(),
    guardarFormulaMock: vi.fn(),
    insertDrogaMock: vi.fn(),
    updateDrogaDatosMock: vi.fn(),
    getDrogaParaAccionMock: vi.fn(),
    lockDrogaParaAccionMock: vi.fn(),
    existeNombreVigenteMock: vi.fn(),
    tieneAlgunaPartidaMock: vi.fn(),
    getEtiquetasUnidadesMock: vi.fn(),
  };
});

vi.mock("@/shared/audit", () => ({
  record: auditRecordMock,
  TipoAccion: {
    CREAR: "CREAR",
    MODIFICAR: "MODIFICAR",
    BAJA: "BAJA",
  },
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/modules/drogas/infrastructure/formula-repository", () => ({
  lockDrogaParaFormula: lockDrogaParaFormulaMock,
  getFormulasDeDrogas: getFormulasDeDrogasMock,
  formulaUsadaEnElaboracion: formulaUsadaEnElaboracionMock,
  eliminarFormula: eliminarFormulaMock,
  getDrogasParaFormula: getDrogasParaFormulaMock,
  drogasConFormula: drogasConFormulaMock,
  formulasQueUsan: formulasQueUsanMock,
  guardarFormula: guardarFormulaMock,
}));

vi.mock("@/modules/drogas/infrastructure/droga-repository", () => ({
  insertDroga: insertDrogaMock,
  updateDrogaDatos: updateDrogaDatosMock,
  getDrogaParaAccion: getDrogaParaAccionMock,
  lockDrogaParaAccion: lockDrogaParaAccionMock,
  existeNombreVigente: existeNombreVigenteMock,
  tieneAlgunaPartida: tieneAlgunaPartidaMock,
  getEtiquetasUnidades: getEtiquetasUnidadesMock,
  getSinonimosDeDrogas: vi.fn(async () => new Map()),
  guardarSinonimos: vi.fn(),
  sinonimoEnUsoPorOtraDroga: vi.fn(async () => null),
}));

vi.mock("@/modules/libro/application/registrar-apertura-contralor", () => ({
  requiereAperturaContralorEnTx: vi.fn(async () => false),
  registrarAperturaContralorEnTx: vi.fn(),
}));

const { aplicarFormulaEnTx } = await import("@/modules/drogas/application/guardar-formula");
const { crearDrogaCommand } = await import("@/modules/drogas/application/crear-droga");
const { editarDrogaCommand } = await import("@/modules/drogas/application/editar-droga");

function fakeSession(permisos: string[] = ["drogas.crear", "drogas.editar"]): AuthenticatedSession {
  return {
    tenantId: TENANT_ID,
    usuario: { id: USUARIO_ID, nombre: "Admin", apellido: "Test", email: "admin@test.com" },
    permisos: new Set(permisos),
  } as unknown as AuthenticatedSession;
}

const TX = { __fakeTx: true } as never;
const DROGA_ID = "22222222-2222-4222-8222-222222222222";
const COMPONENTE_ID = "33333333-3333-4333-8333-333333333333";
const UNIDAD_ID = "44444444-4444-4444-8444-444444444444";

describe("aplicarFormulaEnTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockDrogaParaFormulaMock.mockResolvedValue(true);
    getFormulasDeDrogasMock.mockResolvedValue(new Map());
    formulaUsadaEnElaboracionMock.mockResolvedValue(false);
    drogasConFormulaMock.mockResolvedValue(new Set());
    formulasQueUsanMock.mockResolvedValue([]);
    guardarFormulaMock.mockResolvedValue("formula-id-1");

    getDrogasParaFormulaMock.mockResolvedValue(
      new Map([
        [DROGA_ID, { id: DROGA_ID, nombre: "Jarabe simple", unidadBaseSimbolo: "ml", deBaja: false }],
        [COMPONENTE_ID, { id: COMPONENTE_ID, nombre: "Azúcar", unidadBaseSimbolo: "g", deBaja: false }],
      ]),
    );
  });

  it("create audits CREAR", async () => {
    await aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, {
      cantidadReferencia: dec("100"),
      componentes: [{ drogaId: COMPONENTE_ID, cantidad: dec("85") }],
    });

    expect(guardarFormulaMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        tenantId: TENANT_ID,
        drogaId: DROGA_ID,
        cantidadReferencia: "100",
        componentes: [{ drogaId: COMPONENTE_ID, cantidad: "85" }],
      }),
    );

    expect(auditRecordMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        entidad: "formula_elaboracion",
        entidadId: "formula-id-1",
        accion: "CREAR",
        valorNuevo: {
          drogaId: DROGA_ID,
          cantidadReferencia: "100",
          componentes: [{ droga: "Azúcar", cantidad: "85" }],
        },
      }),
    );
  });

  it("change audits MODIFICAR with before/after", async () => {
    const anterior: FormulaLeida = {
      id: "formula-id-existente",
      drogaId: DROGA_ID,
      cantidadReferencia: "100",
      componentes: [{ drogaId: COMPONENTE_ID, drogaNombre: "Azúcar", cantidad: "80", unidadBaseSimbolo: "g" }],
    };
    getFormulasDeDrogasMock.mockResolvedValue(new Map([[DROGA_ID, anterior]]));

    await aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, {
      cantidadReferencia: dec("100"),
      componentes: [{ drogaId: COMPONENTE_ID, cantidad: dec("85") }],
    });

    expect(auditRecordMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        entidad: "formula_elaboracion",
        entidadId: "formula-id-1",
        accion: "MODIFICAR",
        valorAnterior: {
          cantidadReferencia: "100",
          componentes: [{ droga: "Azúcar", cantidad: "80" }],
        },
        valorNuevo: {
          drogaId: DROGA_ID,
          cantidadReferencia: "100",
          componentes: [{ droga: "Azúcar", cantidad: "85" }],
        },
      }),
    );
  });

  it("null removes and audits BAJA", async () => {
    const anterior: FormulaLeida = {
      id: "formula-id-existente",
      drogaId: DROGA_ID,
      cantidadReferencia: "100",
      componentes: [{ drogaId: COMPONENTE_ID, drogaNombre: "Azúcar", cantidad: "80", unidadBaseSimbolo: "g" }],
    };
    getFormulasDeDrogasMock.mockResolvedValue(new Map([[DROGA_ID, anterior]]));

    await aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, null);

    expect(eliminarFormulaMock).toHaveBeenCalledWith(TX, TENANT_ID, DROGA_ID);
    expect(auditRecordMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        entidad: "formula_elaboracion",
        entidadId: "formula-id-existente",
        accion: "BAJA",
        valorAnterior: {
          drogaId: DROGA_ID,
          cantidadReferencia: "100",
          componentes: [{ droga: "Azúcar", cantidad: "80" }],
        },
      }),
    );
  });

  it("null with no stored fórmula is a no-op", async () => {
    getFormulasDeDrogasMock.mockResolvedValue(new Map());

    await aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, null);

    expect(eliminarFormulaMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("refuses removing a fórmula already used in an elaboración", async () => {
    const anterior: FormulaLeida = {
      id: "formula-id-existente",
      drogaId: DROGA_ID,
      cantidadReferencia: "100",
      componentes: [{ drogaId: COMPONENTE_ID, drogaNombre: "Azúcar", cantidad: "80", unidadBaseSimbolo: "g" }],
    };
    getFormulasDeDrogasMock.mockResolvedValue(new Map([[DROGA_ID, anterior]]));
    formulaUsadaEnElaboracionMock.mockResolvedValue(true);

    try {
      await aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, null);
      expect.unreachable("expected DomainError");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).fields).toEqual(["tieneFormula"]);
    }
  });

  it("refuses a component that is de baja", async () => {
    getDrogasParaFormulaMock.mockResolvedValue(
      new Map([
        [DROGA_ID, { id: DROGA_ID, nombre: "Jarabe simple", unidadBaseSimbolo: "ml", deBaja: false }],
        [COMPONENTE_ID, { id: COMPONENTE_ID, nombre: "Azúcar", unidadBaseSimbolo: "g", deBaja: true }],
      ]),
    );

    try {
      await aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, {
        cantidadReferencia: dec("100"),
        componentes: [{ drogaId: COMPONENTE_ID, cantidad: dec("85") }],
      });
      expect.unreachable("expected DomainError");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).fields).toEqual([`componente_${COMPONENTE_ID}`]);
    }
  });

  it("refuses a droga that is de baja", async () => {
    getDrogasParaFormulaMock.mockResolvedValue(
      new Map([
        [DROGA_ID, { id: DROGA_ID, nombre: "Jarabe simple", unidadBaseSimbolo: "ml", deBaja: true }],
        [COMPONENTE_ID, { id: COMPONENTE_ID, nombre: "Azúcar", unidadBaseSimbolo: "g", deBaja: false }],
      ]),
    );

    await expect(
      aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, {
        cantidadReferencia: dec("100"),
        componentes: [{ drogaId: COMPONENTE_ID, cantidad: dec("85") }],
      }),
    ).rejects.toThrow("La droga está dada de baja: no se puede editar su fórmula.");
  });

  it("refuses the self / one-level rules (via validarFormula)", async () => {
    // 1. Self as component
    try {
      await aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, {
        cantidadReferencia: dec("100"),
        componentes: [{ drogaId: DROGA_ID, cantidad: dec("10") }],
      });
      expect.unreachable("expected DomainError");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).fields).toEqual([`componente_${DROGA_ID}`]);
    }

    // 2. Component has its own formula
    drogasConFormulaMock.mockResolvedValueOnce(new Set([COMPONENTE_ID]));
    try {
      await aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, {
        cantidadReferencia: dec("100"),
        componentes: [{ drogaId: COMPONENTE_ID, cantidad: dec("85") }],
      });
      expect.unreachable("expected DomainError");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).fields).toEqual([`componente_${COMPONENTE_ID}`]);
    }

    // 3. Droga is already a component of another formula
    formulasQueUsanMock.mockResolvedValueOnce(["Otra Droga"]);
    try {
      await aplicarFormulaEnTx(TX, fakeSession(), DROGA_ID, {
        cantidadReferencia: dec("100"),
        componentes: [{ drogaId: COMPONENTE_ID, cantidad: dec("85") }],
      });
      expect.unreachable("expected DomainError");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).fields).toEqual(["componentes"]);
    }
  });
});

describe("crearDrogaCommand / editarDrogaCommand formula handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;

    existeNombreVigenteMock.mockResolvedValue(null);
    lockDrogaParaFormulaMock.mockResolvedValue(true);
    getFormulasDeDrogasMock.mockResolvedValue(new Map());
    formulaUsadaEnElaboracionMock.mockResolvedValue(false);
    drogasConFormulaMock.mockResolvedValue(new Set());
    formulasQueUsanMock.mockResolvedValue([]);
    guardarFormulaMock.mockResolvedValue("formula-id-1");

    getDrogasParaFormulaMock.mockResolvedValue(
      new Map([
        [DROGA_ID, { id: DROGA_ID, nombre: "Nueva Droga", unidadBaseSimbolo: "g", deBaja: false }],
        [COMPONENTE_ID, { id: COMPONENTE_ID, nombre: "Azúcar", unidadBaseSimbolo: "g", deBaja: false }],
      ]),
    );

    insertDrogaMock.mockImplementation(async () => {
      callOrder.push("insertDroga");
      return { id: DROGA_ID, nombre: "Nueva Droga", unidadBaseId: UNIDAD_ID };
    });

    guardarFormulaMock.mockImplementation(async () => {
      callOrder.push("guardarFormula");
      return "formula-id-1";
    });

    getDrogaParaAccionMock.mockResolvedValue({
      id: DROGA_ID,
      nombre: "Droga Existente",
      unidadBaseId: UNIDAD_ID,
      esControlada: false,
      tipoControl: "NINGUNO",
      clase: "DROGA",
      stockMinimo: "0",
      saldoAperturaContralor: null,
      fechaBaja: null,
      deBaja: false,
      unidadBaseNombre: "Gramo",
      unidadBaseSimbolo: "g",
    });
    lockDrogaParaAccionMock.mockResolvedValue(true);
    updateDrogaDatosMock.mockResolvedValue(true);
    tieneAlgunaPartidaMock.mockResolvedValue(false);
    getEtiquetasUnidadesMock.mockResolvedValue(new Map([[UNIDAD_ID, "g"]]));
  });

  it("formula undefined leaves the fórmula untouched (edit)", async () => {
    await editarDrogaCommand.execute(
      {
        id: DROGA_ID,
        nombre: "Droga Existente Modificada",
        stockMinimo: "0",
        // formula omitted -> undefined
        version: {
          nombre: "Droga Existente",
          unidadBaseId: UNIDAD_ID,
          esControlada: false,
          tipoControl: "NINGUNO",
          clase: "DROGA",
          stockMinimo: "0",
        },
      },
      { session: fakeSession() },
    );

    expect(updateDrogaDatosMock).toHaveBeenCalled();
    // formula repository functions never called
    expect(lockDrogaParaFormulaMock).not.toHaveBeenCalled();
    expect(guardarFormulaMock).not.toHaveBeenCalled();
    expect(eliminarFormulaMock).not.toHaveBeenCalled();
  });

  it("formula null removes it (edit)", async () => {
    const anterior: FormulaLeida = {
      id: "formula-id-existente",
      drogaId: DROGA_ID,
      cantidadReferencia: "100",
      componentes: [{ drogaId: COMPONENTE_ID, drogaNombre: "Azúcar", cantidad: "80", unidadBaseSimbolo: "g" }],
    };
    getFormulasDeDrogasMock.mockResolvedValue(new Map([[DROGA_ID, anterior]]));

    await editarDrogaCommand.execute(
      {
        id: DROGA_ID,
        nombre: "Droga Existente Modificada",
        stockMinimo: "0",
        formula: null,
        version: {
          nombre: "Droga Existente",
          unidadBaseId: UNIDAD_ID,
          esControlada: false,
          tipoControl: "NINGUNO",
          clase: "DROGA",
          stockMinimo: "0",
        },
      },
      { session: fakeSession() },
    );

    expect(updateDrogaDatosMock).toHaveBeenCalled();
    expect(eliminarFormulaMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, DROGA_ID);
  });

  it("on alta formula is applied after insertDroga with the new id", async () => {
    await crearDrogaCommand.execute(
      {
        nombre: "Nueva Droga",
        unidadBaseId: UNIDAD_ID,
        stockMinimo: "0",
        formula: {
          cantidadReferencia: "100",
          componentes: [{ drogaId: COMPONENTE_ID, cantidad: "85" }],
        },
      },
      { session: fakeSession() },
    );

    expect(callOrder).toEqual(["insertDroga", "guardarFormula"]);
    expect(guardarFormulaMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        drogaId: DROGA_ID,
        cantidadReferencia: "100",
        componentes: [{ drogaId: COMPONENTE_ID, cantidad: "85" }],
      }),
    );
  });
});
