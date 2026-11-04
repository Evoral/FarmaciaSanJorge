import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  armarTicketCotizacion,
  MENSAJE_COTIZACION_INCOMPLETA,
} from "@/modules/recetas/domain/ticket-cotizacion";
import type { Presupuesto } from "@/modules/recetas/domain/presupuesto";
import {
  getTicketCotizacionQuery,
  imprimirCotizacionPdf,
} from "@/modules/recetas/application/imprimir-cotizacion-pdf";
import { formatFecha } from "@/shared/format/fecha";
import { AuthorizationError, DomainError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/shared/auth/session";

const FAKE_TX = { __fakeTx: true };

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn(FAKE_TX),
}));

const requireSessionMock = vi.fn();
vi.mock("@/shared/auth/session", () => ({
  requireSession: (...args: unknown[]) => requireSessionMock(...args),
  requireRecentReauth: vi.fn(),
}));

const presupuestarMock = vi.fn();
vi.mock("@/modules/recetas/application/presupuestar-receta", () => ({
  presupuestar: (...args: unknown[]) => presupuestarMock(...args),
}));

const zonaHorariaTenantMock = vi.fn();
vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  zonaHorariaTenant: (...args: unknown[]) => zonaHorariaTenantMock(...args),
}));

const getMarcaTenantMock = vi.fn();
vi.mock("@/modules/farmacia/application/get-marca-tenant", () => ({
  getMarcaTenant: (...args: unknown[]) => getMarcaTenantMock(...args),
}));

function fakeSession(permisos: string[] = ["cotizaciones.calcular"]): AuthenticatedSession {
  return {
    usuario: { id: "u-1", email: "user@example.com", nombre: "Juan", apellido: "Pérez" },
    tenantId: "11111111-1111-4111-a111-111111111111",
    sesionId: "s-1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const itemValidoCrema = {
  formaFarmaceutica: "CREMA" as const,
  cantidadUnidades: 1,
  fraccionDosisPorUnidad: "1",
  componentes: [
    {
      drogaId: "b0000000-0000-4000-a000-000000000001",
      cantidad: "10",
      unidadMedidaId: "a0000000-0000-4000-a000-000000000001",
      modoExpresion: "TOTAL" as const,
    },
  ],
};

const itemValidoConDescripcion = {
  ...itemValidoCrema,
  descripcion: "Betametasona crema",
};

describe("armarTicketCotizacion", () => {
  const basePresupuesto: Presupuesto = {
    ok: true,
    total: "5000",
    totalCompleto: true,
    items: [],
    faltantesReceta: [],
  };

  it("one ítem -> its renglón carries the price and total is null", () => {
    const ticket = armarTicketCotizacion({
      farmacia: "Farmacia San Jorge",
      fecha: "04/11/2026",
      paciente: "Juan Pérez",
      medico: "Dra. Ana López",
      items: ["Crema"],
      presupuesto: basePresupuesto,
    });

    expect(ticket.renglones).toEqual([{ texto: "Crema", precio: "5000" }]);
    expect(ticket.total).toBeNull();
  });

  it("two ítems -> renglones without a price and total = presupuesto.total", () => {
    const ticket = armarTicketCotizacion({
      farmacia: "Farmacia San Jorge",
      fecha: "04/11/2026",
      paciente: null,
      medico: null,
      items: ["Crema", "Cápsula"],
      presupuesto: basePresupuesto,
    });

    expect(ticket.renglones).toEqual([
      { texto: "Crema", precio: null },
      { texto: "Cápsula", precio: null },
    ]);
    expect(ticket.total).toBe("5000");
  });

  it("presupuesto.ok === false -> DomainError with its mensaje", () => {
    const presupuestoError: Presupuesto = {
      ok: false,
      mensaje: "No hay regla de precios aplicable.",
    };

    expect(() =>
      armarTicketCotizacion({
        farmacia: "Farmacia San Jorge",
        fecha: "04/11/2026",
        paciente: null,
        medico: null,
        items: ["Crema"],
        presupuesto: presupuestoError,
      }),
    ).toThrow(new DomainError("No hay regla de precios aplicable."));
  });

  it("totalCompleto === false -> DomainError MENSAJE_COTIZACION_INCOMPLETA", () => {
    const presupuestoIncompleto: Presupuesto = {
      ok: true,
      total: "2500",
      totalCompleto: false,
      items: [],
      faltantesReceta: [],
    };

    expect(() =>
      armarTicketCotizacion({
        farmacia: "Farmacia San Jorge",
        fecha: "04/11/2026",
        paciente: null,
        medico: null,
        items: ["Crema", "Cápsula"],
        presupuesto: presupuestoIncompleto,
      }),
    ).toThrow(new DomainError(MENSAJE_COTIZACION_INCOMPLETA));
  });
});

describe("getTicketCotizacionQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zonaHorariaTenantMock.mockResolvedValue("America/Argentina/Buenos_Aires");
    presupuestarMock.mockResolvedValue({
      ok: true,
      total: "3500",
      totalCompleto: true,
      items: [],
      faltantesReceta: [],
    });
  });

  it("rejected without cotizaciones.calcular (AuthorizationError)", async () => {
    const sessionSinPermiso = fakeSession([]);

    await expect(
      getTicketCotizacionQuery.execute(
        {
          farmacia: "Farmacia San Jorge",
          paciente: "Juan Pérez",
          medico: "Dr. Gómez",
          items: [itemValidoCrema],
        },
        { session: sessionSinPermiso },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("an ítem without descripcion reads as its FORMA_FARMACEUTICA_LABELS label, one with descripcion reads as the descripcion", async () => {
    const session = fakeSession(["cotizaciones.calcular"]);

    const ticket = await getTicketCotizacionQuery.execute(
      {
        farmacia: "Farmacia San Jorge",
        paciente: null,
        medico: null,
        items: [itemValidoCrema, itemValidoConDescripcion],
      },
      { session },
    );

    expect(ticket.renglones[0]?.texto).toBe("Crema");
    expect(ticket.renglones[1]?.texto).toBe("Betametasona crema");
  });

  it('paciente/médico "" or whitespace -> null', async () => {
    const session = fakeSession(["cotizaciones.calcular"]);

    const ticket = await getTicketCotizacionQuery.execute(
      {
        farmacia: "Farmacia San Jorge",
        paciente: "   ",
        medico: "",
        items: [itemValidoCrema],
      },
      { session },
    );

    expect(ticket.paciente).toBeNull();
    expect(ticket.medico).toBeNull();
  });

  it("the price comes from presupuestar (assert called with request items, never client price)", async () => {
    const session = fakeSession(["cotizaciones.calcular"]);

    const ticket = await getTicketCotizacionQuery.execute(
      {
        farmacia: "Farmacia San Jorge",
        paciente: "Carlos",
        medico: "Dra. Gomez",
        items: [itemValidoCrema],
      },
      { session },
    );

    expect(presupuestarMock).toHaveBeenCalledTimes(1);
    expect(presupuestarMock).toHaveBeenCalledWith(
      FAKE_TX,
      session.tenantId,
      [expect.objectContaining({ formaFarmaceutica: "CREMA" })],
    );
    expect(ticket.renglones[0]?.precio).toBe("3500");
  });

  it("the fecha is formatted in the tenant's zona horaria (mock zonaHorariaTenant)", async () => {
    const session = fakeSession(["cotizaciones.calcular"]);
    zonaHorariaTenantMock.mockResolvedValue("America/Argentina/Cordoba");

    const ticket = await getTicketCotizacionQuery.execute(
      {
        farmacia: "Farmacia San Jorge",
        paciente: null,
        medico: null,
        items: [itemValidoCrema],
      },
      { session },
    );

    expect(zonaHorariaTenantMock).toHaveBeenCalledWith(FAKE_TX, session.tenantId);
    expect(ticket.fecha).toBe(formatFecha(new Date(), "America/Argentina/Cordoba"));
  });
});

describe("imprimirCotizacionPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue(fakeSession(["cotizaciones.calcular"]));
    getMarcaTenantMock.mockResolvedValue({ nombre: "Farmacia Central", logoSrc: null });
    zonaHorariaTenantMock.mockResolvedValue("America/Argentina/Buenos_Aires");
    presupuestarMock.mockResolvedValue({
      ok: true,
      total: "4200",
      totalCompleto: true,
      items: [],
      faltantesReceta: [],
    });
  });

  it("passes getMarcaTenant()'s nombre as farmacia and returns a Buffer that starts with %PDF", async () => {
    const executeSpy = vi.spyOn(getTicketCotizacionQuery, "execute");
    const pdf = await imprimirCotizacionPdf({
      paciente: "Juan Pérez",
      medico: "Dr. Gómez",
      items: [itemValidoCrema],
    });

    expect(getMarcaTenantMock).toHaveBeenCalledTimes(1);
    // The name must reach the ticket, not just be read.
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ farmacia: "Farmacia Central" }));
    const ticket = await executeSpy.mock.results[0]!.value;
    expect(ticket.farmacia).toBe("Farmacia Central");
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString("utf-8")).toBe("%PDF");
    executeSpy.mockRestore();
  });
});
