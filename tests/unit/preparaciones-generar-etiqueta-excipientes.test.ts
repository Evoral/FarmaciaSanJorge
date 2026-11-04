/**
 * Unit tests for generarEtiquetaEnTx (modules/preparaciones/application/generar-etiqueta.ts):
 * - explicit true/false wins over tenant default without querying getIncluirExcipientesEnEtiqueta
 * - undefined reads getIncluirExcipientesEnEtiqueta (tenant default)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const PREPARACION_ID = "22222222-2222-4222-8222-222222222222";

const repoMock = vi.hoisted(() => ({
  getEtiquetaExistente: vi.fn(),
  getPreparacionParaEtiqueta: vi.fn(),
  getIncluirExcipientesEnEtiqueta: vi.fn(),
  insertEtiqueta: vi.fn(),
}));

vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", () => repoMock);

const { generarEtiquetaEnTx } = await import(
  "@/modules/preparaciones/application/generar-etiqueta"
);

const DATOS_PREPARACION = {
  formaFarmaceutica: "CAPSULA",
  cantidadUnidades: 30,
  componentes: [
    {
      drogaNombre: "Mazindol",
      cantidad: "2",
      unidadSimbolo: "mg",
      modoExpresion: "POR_DOSIS" as const,
      esPrincipioActivo: true,
    },
    {
      drogaNombre: "Lactosa",
      cantidad: null,
      unidadSimbolo: "g",
      modoExpresion: "CSP" as const,
      esPrincipioActivo: false,
    },
  ],
  excipientes: ["Ludipress 0,795 g"],
  asientoNumeroCorrelativo: "1520",
  recetaNumeroInterno: "88",
  pacienteTexto: "Pérez, Juan",
  medicoNombre: "Ana",
  medicoApellido: "Gómez",
  medicoMatricula: "4521",
  medicoJurisdiccion: "PROVINCIAL" as const,
  directorTecnico: { nombre: "María", apellido: "López", matricula: "3310" },
  tenantDomicilio: "Av. San Martín 1234",
  tenantTelefonoFijo: null,
  tenantTelefonoCelular: null,
  posologia: "1 cápsula por día",
  fraccionDosisPorUnidad: "1",
  fechaVencimiento: "2027-03-15",
  tipoVencimiento: "ESTANDAR" as const,
  itemDescripcion: "Mazindol 2 mg cápsulas",
  recetaEstado: "CONFIRMADA",
  asientoSinEfecto: false,
};

describe("generarEtiquetaEnTx: incluirExcipientes precedence", () => {
  const fakeTx = { __fakeTx: true } as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    vi.clearAllMocks();
    repoMock.getEtiquetaExistente.mockResolvedValue(null);
    repoMock.getPreparacionParaEtiqueta.mockResolvedValue(DATOS_PREPARACION);
    repoMock.insertEtiqueta.mockResolvedValue({ id: "etiqueta-1" });
  });

  it("explicit true wins: does NOT read tenant default and formats label with excipientes", async () => {
    repoMock.getIncluirExcipientesEnEtiqueta.mockResolvedValue(false);

    const resultado = await generarEtiquetaEnTx(fakeTx, TENANT_ID, PREPARACION_ID, true);

    expect(resultado).toEqual({
      id: "etiqueta-1",
      preparacion: "Mazindol 2 mg cápsulas — asiento Nº 1520",
    });
    expect(repoMock.getIncluirExcipientesEnEtiqueta).not.toHaveBeenCalled();
    expect(repoMock.insertEtiqueta).toHaveBeenCalledTimes(1);

    const contenidoGenerado = repoMock.insertEtiqueta.mock.calls[0]![3] as string;
    expect(contenidoGenerado).toContain("Lactosa (excipiente)");
    expect(contenidoGenerado).toContain("Ludipress 0,795 g (excipiente)");
  });

  it("explicit false wins: does NOT read tenant default and formats label WITHOUT excipientes", async () => {
    repoMock.getIncluirExcipientesEnEtiqueta.mockResolvedValue(true);

    const resultado = await generarEtiquetaEnTx(fakeTx, TENANT_ID, PREPARACION_ID, false);

    expect(resultado).toEqual({
      id: "etiqueta-1",
      preparacion: "Mazindol 2 mg cápsulas — asiento Nº 1520",
    });
    expect(repoMock.getIncluirExcipientesEnEtiqueta).not.toHaveBeenCalled();
    expect(repoMock.insertEtiqueta).toHaveBeenCalledTimes(1);

    const contenidoGenerado = repoMock.insertEtiqueta.mock.calls[0]![3] as string;
    expect(contenidoGenerado).toContain("Mazindol 2 mg");
    expect(contenidoGenerado).not.toContain("(excipiente)");
  });

  it("undefined falls back to tenant default: when true, includes excipientes", async () => {
    repoMock.getIncluirExcipientesEnEtiqueta.mockResolvedValue(true);

    await generarEtiquetaEnTx(fakeTx, TENANT_ID, PREPARACION_ID, undefined);

    expect(repoMock.getIncluirExcipientesEnEtiqueta).toHaveBeenCalledWith(fakeTx, TENANT_ID);
    const contenidoGenerado = repoMock.insertEtiqueta.mock.calls[0]![3] as string;
    expect(contenidoGenerado).toContain("Lactosa (excipiente)");
    expect(contenidoGenerado).toContain("Ludipress 0,795 g (excipiente)");
  });

  it("undefined falls back to tenant default: when false, excludes excipientes", async () => {
    repoMock.getIncluirExcipientesEnEtiqueta.mockResolvedValue(false);

    await generarEtiquetaEnTx(fakeTx, TENANT_ID, PREPARACION_ID);

    expect(repoMock.getIncluirExcipientesEnEtiqueta).toHaveBeenCalledWith(fakeTx, TENANT_ID);
    const contenidoGenerado = repoMock.insertEtiqueta.mock.calls[0]![3] as string;
    expect(contenidoGenerado).toContain("Mazindol 2 mg");
    expect(contenidoGenerado).not.toContain("(excipiente)");
  });
});
