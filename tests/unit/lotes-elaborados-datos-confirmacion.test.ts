/**
 * Unit tests for `construirDatosConfirmacion` and confirmation queries (openspec/changes/lotes-elaborados, P13).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";

const {
  jornadaActualTenantMock,
  getLineasParaPreparacionMock,
  getParametrosPesadaRealMock,
  listPartidasElegiblesDrogaMock,
  existeCierreParaJornadaMock,
  diasAlertaVencimientoEnTxMock,
  getMesesVencimientoPreparadoMock,
  listUnidadesFormatoMock,
  listDtParaCoFirmaEnTxMock,
  getFichaParaIniciarMock,
  getBorradoresDeFichaMock,
  getFormaDeItemDeFichaMock,
  listExcipientesParaTomaMock,
  getExcipienteBorradorMock,
  listInsumosParaTomaMock,
  listInsumosBorradorMock,
  getPreparacionParaAccionMock,
  getRecetaDePreparacionMock,
  listReservasDePreparacionMock,
  withTenantTransactionMock,
  auditRecordMock,
} = vi.hoisted(() => ({
  jornadaActualTenantMock: vi.fn(),
  getLineasParaPreparacionMock: vi.fn(),
  getParametrosPesadaRealMock: vi.fn(),
  listPartidasElegiblesDrogaMock: vi.fn(),
  existeCierreParaJornadaMock: vi.fn(),
  diasAlertaVencimientoEnTxMock: vi.fn(),
  getMesesVencimientoPreparadoMock: vi.fn(),
  listUnidadesFormatoMock: vi.fn(),
  listDtParaCoFirmaEnTxMock: vi.fn(),
  getFichaParaIniciarMock: vi.fn(),
  getBorradoresDeFichaMock: vi.fn(),
  getFormaDeItemDeFichaMock: vi.fn(),
  listExcipientesParaTomaMock: vi.fn(),
  getExcipienteBorradorMock: vi.fn(),
  listInsumosParaTomaMock: vi.fn(),
  listInsumosBorradorMock: vi.fn(),
  getPreparacionParaAccionMock: vi.fn(),
  getRecetaDePreparacionMock: vi.fn(),
  listReservasDePreparacionMock: vi.fn(),
  withTenantTransactionMock: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({ __fakeTx: true }),
  ),
  auditRecordMock: vi.fn(async () => undefined),
}));

vi.mock("@/shared/audit", () => ({
  record: auditRecordMock,
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", () => ({
  jornadaActualTenant: jornadaActualTenantMock,
  getLineasParaPreparacion: getLineasParaPreparacionMock,
  getParametrosPesadaReal: getParametrosPesadaRealMock,
  listPartidasElegiblesDroga: listPartidasElegiblesDrogaMock,
  existeCierreParaJornada: existeCierreParaJornadaMock,
  getMesesVencimientoPreparado: getMesesVencimientoPreparadoMock,
  listUnidadesFormato: listUnidadesFormatoMock,
  getFichaParaIniciar: getFichaParaIniciarMock,
  getBorradoresDeFicha: getBorradoresDeFichaMock,
  getFormaDeItemDeFicha: getFormaDeItemDeFichaMock,
  listExcipientesParaToma: listExcipientesParaTomaMock,
  getExcipienteBorrador: getExcipienteBorradorMock,
  listInsumosParaToma: listInsumosParaTomaMock,
  listInsumosBorrador: listInsumosBorradorMock,
  getPreparacionParaAccion: getPreparacionParaAccionMock,
  getRecetaDePreparacion: getRecetaDePreparacionMock,
  listReservasDePreparacion: listReservasDePreparacionMock,
}));

vi.mock("@/modules/stock/application/dias-alerta-vencimiento", () => ({
  diasAlertaVencimientoEnTx: diasAlertaVencimientoEnTxMock,
}));

vi.mock("@/modules/stock/application/list-dt-para-co-firma", () => ({
  listDtParaCoFirmaEnTx: listDtParaCoFirmaEnTxMock,
}));

const { construirDatosConfirmacion } = await import(
  "@/modules/preparaciones/application/datos-confirmacion"
);
const { getConfirmacionDeFichaQuery } = await import(
  "@/modules/preparaciones/application/get-confirmacion-de-ficha"
);
const { getPreparacionParaPantallaQuery } = await import(
  "@/modules/preparaciones/application/get-preparacion-para-pantalla"
);
const { getRecalculoDeReservaQuery } = await import(
  "@/modules/preparaciones/application/get-recalculo-de-reserva"
);

const TX = { __fakeTx: true } as never;
const TENANT = "11111111-1111-4111-8111-111111111111";
const FICHA_ID = "22222222-2222-4222-8222-222222222222";
const PREPARACION_ID = "33333333-3333-4333-8333-333333333333";

function fakeSession(permisos: string[]): AuthenticatedSession {
  return {
    tenantId: TENANT,
    usuario: { id: "99999999-9999-4999-8999-999999999999", nombre: "Op", apellido: "Test", email: "op@test.com" },
    permisos: new Set(permisos),
  } as unknown as AuthenticatedSession;
}

describe("construirDatosConfirmacion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jornadaActualTenantMock.mockResolvedValue("2026-10-29");
    getParametrosPesadaRealMock.mockResolvedValue({
      precisionBalanza: "0.001", // 1 mg (0.001 g)
      toleranciaPorcentaje: "5",
    });
    existeCierreParaJornadaMock.mockResolvedValue(false);
    diasAlertaVencimientoEnTxMock.mockResolvedValue(30);
    getMesesVencimientoPreparadoMock.mockResolvedValue(1);
    listUnidadesFormatoMock.mockResolvedValue([]);
    listDtParaCoFirmaEnTxMock.mockResolvedValue([]);
    getFichaParaIniciarMock.mockResolvedValue({ id: FICHA_ID });
    getBorradoresDeFichaMock.mockResolvedValue(new Map());
    getFormaDeItemDeFichaMock.mockResolvedValue(null);
    listExcipientesParaTomaMock.mockResolvedValue([]);
    getExcipienteBorradorMock.mockResolvedValue(null);
    listInsumosParaTomaMock.mockResolvedValue([]);
    listInsumosBorradorMock.mockResolvedValue([]);
    getPreparacionParaAccionMock.mockResolvedValue({
      id: PREPARACION_ID,
      fichaTecnicaId: FICHA_ID,
      itemRecetaId: "33333333-3333-4333-8333-333333333333",
      estado: "INICIADA",
    });
    getRecetaDePreparacionMock.mockResolvedValue(null);
    listReservasDePreparacionMock.mockResolvedValue([
      {
        lineaPesajeId: "linea-1",
        partidaId: "44444444-4444-4444-8444-444444444444",
        cantidad: "1",
        cantidadManual: null,
        motivoAperturaAdicional: null,
        cantidadReal: null,
      },
    ]);
  });

  it("per-línea bajoLaBalanza is true only for a non-manual MASA línea whose cantidadAPesar is below one division", async () => {
    const GRAMO = { id: "u-g", codigo: "GRAMO", simbolo: "g", tipoMagnitud: "MASA", factorABase: "1" };
    const MILILITRO = { id: "u-ml", codigo: "MILILITRO", simbolo: "ml", tipoMagnitud: "VOLUMEN", factorABase: "1" };

    getLineasParaPreparacionMock.mockResolvedValue([
      // 1. Non-manual MASA below 1 division (0.00015 < 0.001) -> true
      {
        id: "linea-1",
        drogaId: "droga-1",
        drogaNombre: "Droga X",
        unidad: GRAMO,
        unidadStock: GRAMO,
        cantidadAPesar: "0.00015",
        esEnraseManual: false,
        orden: 1,
        modoExpresion: "PORCENTAJE",
      },
      // 2. Non-manual MASA above 1 division (0.05 > 0.001) -> false
      {
        id: "linea-2",
        drogaId: "droga-2",
        drogaNombre: "Droga Y",
        unidad: GRAMO,
        unidadStock: GRAMO,
        cantidadAPesar: "0.05",
        esEnraseManual: false,
        orden: 2,
        modoExpresion: "PORCENTAJE",
      },
      // 3. Manual enrase MASA -> false
      {
        id: "linea-3",
        drogaId: "droga-3",
        drogaNombre: "Excipiente",
        unidad: GRAMO,
        unidadStock: GRAMO,
        cantidadAPesar: null,
        esEnraseManual: true,
        orden: 3,
        modoExpresion: "PORCENTAJE",
      },
      // 4. Non-manual VOLUMEN (not MASA) with tiny quantity -> false
      {
        id: "linea-4",
        drogaId: "droga-4",
        drogaNombre: "Solución",
        unidad: MILILITRO,
        unidadStock: MILILITRO,
        cantidadAPesar: "0.0001",
        esEnraseManual: false,
        orden: 4,
        modoExpresion: "PORCENTAJE",
      },
    ]);

    listPartidasElegiblesDrogaMock.mockResolvedValue([]);

    const datos = await construirDatosConfirmacion(TX, TENANT, FICHA_ID);

    expect(datos.lineas).toHaveLength(4);
    expect(datos.lineas[0]!.bajoLaBalanza).toBe(true);
    expect(datos.lineas[1]!.bajoLaBalanza).toBe(false);
    expect(datos.lineas[2]!.bajoLaBalanza).toBe(false);
    expect(datos.lineas[3]!.bajoLaBalanza).toBe(false);
  });

  it("esDilucion passes through", async () => {
    const GRAMO = { id: "u-g", codigo: "GRAMO", simbolo: "g", tipoMagnitud: "MASA", factorABase: "1" };
    getLineasParaPreparacionMock.mockResolvedValue([
      {
        id: "linea-1",
        drogaId: "droga-1",
        drogaNombre: "Droga X",
        unidad: GRAMO,
        unidadStock: GRAMO,
        cantidadAPesar: "0.00015",
        esEnraseManual: false,
        orden: 1,
        modoExpresion: "PORCENTAJE",
      },
    ]);

    listPartidasElegiblesDrogaMock.mockResolvedValue([
      {
        id: "p-pura",
        lote: "L-PURA",
        proveedorNombre: "Prov",
        cantidadDisponible: "10",
        unidadSimbolo: "g",
        fechaVencimiento: "2027-01-01",
        reanalizada: false,
        fechaApertura: null,
        potenciaDeclarada: null,
        esDilucion: false,
      },
      {
        id: "p-diluida",
        lote: "L-DIL",
        proveedorNombre: "Elaborado en farmacia",
        cantidadDisponible: "100",
        unidadSimbolo: "g",
        fechaVencimiento: "2027-01-01",
        reanalizada: false,
        fechaApertura: null,
        potenciaDeclarada: "1",
        esDilucion: true,
      },
    ]);

    const datos = await construirDatosConfirmacion(TX, TENANT, FICHA_ID);
    const partidas = datos.lineas[0]!.partidasElegibles;
    expect(partidas).toHaveLength(2);
    expect(partidas.find((p) => p.id === "p-pura")!.esDilucion).toBe(false);
    expect(partidas.find((p) => p.id === "p-diluida")!.esDilucion).toBe(true);
  });

  describe("puedeElaborarLote in confirmation queries", () => {
    describe("getConfirmacionDeFichaQuery", () => {
      it("is true when session has stock.lote.elaborar", async () => {
        const session = fakeSession(["preparaciones.iniciar", "stock.lote.elaborar"]);
        const res = await getConfirmacionDeFichaQuery.execute({ fichaTecnicaId: FICHA_ID }, { session });
        expect(res.puedeElaborarLote).toBe(true);
      });

      it("is false when session lacks stock.lote.elaborar", async () => {
        const session = fakeSession(["preparaciones.iniciar"]);
        const res = await getConfirmacionDeFichaQuery.execute({ fichaTecnicaId: FICHA_ID }, { session });
        expect(res.puedeElaborarLote).toBe(false);
      });
    });

    describe("getPreparacionParaPantallaQuery", () => {
      it("is true when session has stock.lote.elaborar", async () => {
        const session = fakeSession(["preparaciones.iniciar", "stock.lote.elaborar"]);
        const res = await getPreparacionParaPantallaQuery.execute({ preparacionId: PREPARACION_ID }, { session });
        expect(res.puedeElaborarLote).toBe(true);
      });

      it("is false when session lacks stock.lote.elaborar", async () => {
        const session = fakeSession(["preparaciones.iniciar"]);
        const res = await getPreparacionParaPantallaQuery.execute({ preparacionId: PREPARACION_ID }, { session });
        expect(res.puedeElaborarLote).toBe(false);
      });
    });

    describe("getRecalculoDeReservaQuery", () => {
      it("is true when session has stock.lote.elaborar", async () => {
        const session = fakeSession(["preparaciones.iniciar", "stock.lote.elaborar"]);
        const res = await getRecalculoDeReservaQuery.execute({ preparacionId: PREPARACION_ID }, { session });
        expect(res.puedeElaborarLote).toBe(true);
      });

      it("is false when session lacks stock.lote.elaborar", async () => {
        const session = fakeSession(["preparaciones.iniciar"]);
        const res = await getRecalculoDeReservaQuery.execute({ preparacionId: PREPARACION_ID }, { session });
        expect(res.puedeElaborarLote).toBe(false);
      });
    });
  });
});
