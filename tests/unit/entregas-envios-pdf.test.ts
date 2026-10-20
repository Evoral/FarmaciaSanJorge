/**
 * "Exportar envíos" (docs/specs/envios-repartidores.md, plan item 6): input validation of `imprimirEnviosPdf`, the
 * `cotizaciones.ver` gate of the Importe column (E10), the repartidor lookup, the file name (no patient data), the
 * pure rules of the hoja (`domain/hoja-envios.ts`), the table's shape and a PDF smoke test. Mocked repository/tx, no
 * DB: the SQL of `listEnviosDeRepartidor` is covered by the shared DB, not here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { HOJA_ANCHO_UTIL } from "@/shared/pdf/hojas";
import {
  MENSAJE_HOJA_ENVIOS_VACIA,
  TEXTO_PAGO_IMPAGA,
  TEXTO_PAGO_PAGADA,
  nombreArchivoHojaEnvios,
  slugApellido,
  textoFiltroHoja,
  textoPagoHoja,
} from "@/modules/entregas/domain/hoja-envios";
import type { EnvioDeRepartidor } from "@/modules/entregas/infrastructure/entrega-repository";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }),
}));

let sesionActual: AuthenticatedSession;
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => sesionActual),
  requireRecentReauth: vi.fn(),
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const REPARTIDOR_ID = "44444444-4444-4444-a444-444444444444";
const ZONA = "America/Argentina/Mendoza";

function sesionCon(...permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "u@example.com", nombre: "Ana", apellido: "Gómez" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

function envio(numero: number, sobrescribe: Partial<EnvioDeRepartidor> = {}): EnvioDeRepartidor {
  return {
    recetaId: `r-${numero}`,
    numeroInterno: String(numero),
    entregadaEn: new Date("2026-10-20T15:30:00Z"),
    pacienteApellido: "Pérez",
    pacienteNombre: "Juan",
    pacienteDni: "12345678",
    pacienteTelefono: "261 555-0000",
    domicilio: "Calle Falsa 123, Ciudad Ejemplo",
    pagada: true,
    itemsPreparados: 2,
    precio: "1500.5",
    precioIncompleto: false,
    ...sobrescribe,
  };
}

const getRepartidorMock = vi.fn();
const listEnviosMock = vi.fn();
const getFarmaciaMock = vi.fn();
const zonaHorariaMock = vi.fn();

vi.mock("@/modules/entregas/infrastructure/entrega-repository", () => ({
  getRepartidorDeEntrega: (...args: unknown[]) => getRepartidorMock(...args),
  listEnviosDeRepartidor: (...args: unknown[]) => listEnviosMock(...args),
  getFarmaciaParaHoja: (...args: unknown[]) => getFarmaciaMock(...args),
  zonaHorariaTenant: (...args: unknown[]) => zonaHorariaMock(...args),
}));

const { imprimirEnviosPdf, getHojaEnviosQuery, getFechaHoyEnvios } = await import("@/modules/entregas/application/imprimir-envios-pdf");
const { buildEnviosPdf, columnasHojaEnvios, filasHojaEnvios } = await import("@/modules/entregas/infrastructure/envios-pdf");

beforeEach(() => {
  sesionActual = sesionCon("entregas.registrar");
  getRepartidorMock.mockReset().mockResolvedValue({ id: REPARTIDOR_ID, nombre: "Luis", apellido: "Núñez de Arce", telefono: "261 444-1111" });
  listEnviosMock.mockReset().mockResolvedValue([envio(1), envio(2, { pagada: false })]);
  getFarmaciaMock.mockReset().mockResolvedValue({ nombre: "Farmacia Ejemplo", telefonoFijo: "261 400-0000", telefonoCelular: null });
  zonaHorariaMock.mockReset().mockResolvedValue(ZONA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("imprimirEnviosPdf -- input", () => {
  it("renders a PDF and a file name without patient data for a repartidor and a fecha", async () => {
    const { pdf, filename } = await imprimirEnviosPdf({ repartidorId: REPARTIDOR_ID, fecha: "2026-10-20" });

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(filename).toBe("envios-nunez-de-arce-2026-10-20.pdf");
    expect(listEnviosMock.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT_ID, repartidorId: REPARTIDOR_ID, fecha: "2026-10-20" });
  });

  it("without a fecha it lists every pending envío and the file name says so", async () => {
    const { filename } = await imprimirEnviosPdf({ repartidorId: REPARTIDOR_ID });

    expect(filename).toBe("envios-nunez-de-arce-pendientes.pdf");
    expect(listEnviosMock.mock.calls[0]![1]).toMatchObject({ fecha: null });
  });

  it.each([
    ["a repartidorId that is not a uuid", { repartidorId: "no-es-uuid" }],
    ["an empty repartidorId", { repartidorId: "" }],
    ["a fecha in another format", { repartidorId: REPARTIDOR_ID, fecha: "20/10/2026" }],
    ["a fecha that does not exist", { repartidorId: REPARTIDOR_ID, fecha: "2026-02-31" }],
  ])("rejects %s before reading anything", async (_name, input) => {
    await expect(imprimirEnviosPdf(input)).rejects.toBeInstanceOf(ValidationError);
    expect(getRepartidorMock).not.toHaveBeenCalled();
    expect(listEnviosMock).not.toHaveBeenCalled();
  });

  it("a repartidor that does not exist in the tenant is NOT_FOUND", async () => {
    getRepartidorMock.mockResolvedValue(null);

    await expect(imprimirEnviosPdf({ repartidorId: REPARTIDOR_ID })).rejects.toBeInstanceOf(NotFoundError);
    expect(listEnviosMock).not.toHaveBeenCalled();
  });
});

describe("imprimirEnviosPdf -- Importe column (E10)", () => {
  it("without cotizaciones.ver the price is neither read nor printed", async () => {
    const datos = await getHojaEnviosQuery.execute({ repartidorId: REPARTIDOR_ID }, { session: sesionCon("entregas.registrar") });

    expect(datos.conImporte).toBe(false);
    expect(listEnviosMock.mock.calls[0]![1]).toMatchObject({ conPrecio: false });
  });

  it("with cotizaciones.ver the price is read and printed", async () => {
    const datos = await getHojaEnviosQuery.execute({ repartidorId: REPARTIDOR_ID }, { session: sesionCon("entregas.registrar", "cotizaciones.ver") });

    expect(datos.conImporte).toBe(true);
    expect(listEnviosMock.mock.calls[0]![1]).toMatchObject({ conPrecio: true });
  });

  it("names who generated it as 'Apellido, Nombre' of the session's usuario", async () => {
    const datos = await getHojaEnviosQuery.execute({ repartidorId: REPARTIDOR_ID }, { session: sesionCon("entregas.registrar") });

    expect(datos.generadaPor).toBe("Gómez, Ana");
  });
});

describe("getFechaHoyEnvios", () => {
  it("is today in the farmacia's time zone, not in UTC", async () => {
    // 01:30 UTC of the 21st is still 22:30 of the 20th in Mendoza (UTC-3).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T01:30:00Z"));

    expect(await getFechaHoyEnvios()).toBe("2026-10-20");
  });
});

describe("hoja de envíos -- pure rules", () => {
  it("prints the fecha as dd/mm/aaaa, or 'Todos los pendientes'", () => {
    expect(textoFiltroHoja("2026-10-20")).toBe("Fecha de envío: 20/10/2026");
    expect(textoFiltroHoja(null)).toBe("Todos los pendientes");
  });

  it("marks the unpaid ones to charge", () => {
    expect(textoPagoHoja(true)).toBe(TEXTO_PAGO_PAGADA);
    expect(textoPagoHoja(false)).toBe(TEXTO_PAGO_IMPAGA);
    expect(TEXTO_PAGO_IMPAGA).toBe("IMPAGA — cobrar");
  });

  it("builds the file name from the apellido only, in ASCII", () => {
    expect(slugApellido("Núñez de Arce")).toBe("nunez-de-arce");
    expect(slugApellido("  ¿? ")).toBe("repartidor");
    expect(nombreArchivoHojaEnvios("Pérez", "2026-10-20")).toBe("envios-perez-2026-10-20.pdf");
    expect(nombreArchivoHojaEnvios("Pérez", null)).toBe("envios-perez-pendientes.pdf");
  });
});

describe("hoja de envíos -- table", () => {
  const CLAVES_BASE = ["receta", "enviada", "paciente", "telefono", "domicilio", "preparados", "pago", "recibio"];

  it("has no Importe column without cotizaciones.ver, and Recibió is the last column, wide enough to sign", () => {
    const columnas = columnasHojaEnvios(false);

    expect(columnas.map((c) => c.clave)).toEqual(CLAVES_BASE);
    expect(columnas.reduce((total, c) => total + c.width, 0)).toBe(HOJA_ANCHO_UTIL);
    expect(columnas.at(-1)!.width).toBeGreaterThanOrEqual(140);
  });

  it("adds Importe before Recibió with cotizaciones.ver, still filling the page width (Domicilio gives up the room)", () => {
    const sin = columnasHojaEnvios(false);
    const con = columnasHojaEnvios(true);
    const ancho = (columnas: typeof con, clave: string) => columnas.find((c) => c.clave === clave)!.width;

    expect(con.map((c) => c.clave)).toEqual([...CLAVES_BASE.slice(0, 7), "importe", "recibio"]);
    expect(con.reduce((total, c) => total + c.width, 0)).toBe(HOJA_ANCHO_UTIL);
    expect(ancho(sin, "domicilio") - ancho(con, "domicilio")).toBe(ancho(con, "importe"));
  });

  it("builds one row per envío; the importe only exists with cotizaciones.ver", () => {
    const envios = [envio(1), envio(2, { pagada: false, precio: null, pacienteDni: null, pacienteTelefono: null, domicilio: null })];

    expect(filasHojaEnvios(envios, false, ZONA).map((f) => f.importe)).toEqual([null, null]);
    expect(filasHojaEnvios(envios, true, ZONA).every((f) => f.importe !== null)).toBe(true);
  });

  it("keeps the payment state, the DNI note, and '—' for a missing teléfono or domicilio", () => {
    const [pagada, impaga] = filasHojaEnvios([envio(1), envio(2, { pagada: false, pacienteDni: null, pacienteTelefono: null, domicilio: null })], false, ZONA);

    expect(pagada!.pagada).toBe(true);
    expect(pagada!.dni).toMatch(/^DNI /);
    expect(impaga!.pagada).toBe(false);
    expect(impaga!.dni).toBeNull();
    expect(impaga!.telefono).toBe("—");
    expect(impaga!.domicilio).toBe("—");
  });

  it("shows the importe, 'incompleto' under a partial one and 'Sin cotizar' when there is none", () => {
    const filas = filasHojaEnvios([envio(1), envio(2, { precioIncompleto: true }), envio(3, { precio: null })], true, ZONA);

    expect(filas[0]!.importe).toEqual({ texto: "$ 1.500,50" });
    expect(filas[1]!.importe).toEqual({ texto: "$ 1.500,50", nota: "incompleto" });
    expect(filas[2]!.importe).toEqual({ texto: "Sin cotizar", sinCotizar: true });
  });

  it("shows the receta number and the envío's day and time in the farmacia's zone", () => {
    const [fila] = filasHojaEnvios([envio(1)], false, ZONA);

    expect(fila!.receta).toMatch(/^Nº /);
    expect(fila!.fecha).toBe("20/10/2026");
    expect(fila!.hora).toBe("12:30");
  });
});

describe("hoja de envíos -- PDF", () => {
  const datos = (envios: EnvioDeRepartidor[], conImporte: boolean) => ({
    farmacia: { nombre: "Farmacia Ejemplo", telefonoFijo: "261 400-0000", telefonoCelular: "261 15 555-0000" },
    repartidor: { id: REPARTIDOR_ID, nombre: "Luis", apellido: "Núñez", telefono: "261 444-1111" },
    fecha: "2026-10-20" as string | null,
    envios,
    conImporte,
    zonaHoraria: ZONA,
    generadaEn: new Date("2026-10-20T15:00:00Z"),
    generadaPor: "Gómez, Ana",
  });

  const paginas = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

  it.each([false, true])("renders a landscape A4 PDF (conImporte=%s)", async (conImporte) => {
    const pdf = await buildEnviosPdf(datos([envio(1), envio(2, { pagada: false })], conImporte));

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+841\.89\s+595\.28\s*\]/);
  });

  it("an empty result still renders the header and the notice (a single sheet)", async () => {
    const pdf = await buildEnviosPdf(datos([], false));

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(paginas(pdf)).toBe(1);
    expect(MENSAJE_HOJA_ENVIOS_VACIA).toBe("Este repartidor no tiene envíos pendientes para este filtro");
  });

  it("many envíos continue on more sheets", async () => {
    const muchos = Array.from({ length: 60 }, (_, i) => envio(i + 1, { pagada: i % 3 !== 0 }));

    const pdf = await buildEnviosPdf(datos(muchos, true));

    expect(paginas(pdf)).toBeGreaterThan(1);
  });
});
