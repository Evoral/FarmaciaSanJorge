/**
 * `libro.integridad.registrarIncidentes` and its fail-soft wrapper (openspec/changes/incidentes-integridad-plataforma,
 * design D3-D5, D7): the layout awaits the wrapper, so it must never throw (except Next's own control-flow errors).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { redirect } from "next/navigation";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError } from "@/shared/errors";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

const TENANT = "11111111-1111-4111-a111-111111111111";
const LIBRO_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const LIBRO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function sessionWith(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT,
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const requireSessionMock = vi.fn(async () => sessionWith(["libro.ver"]));
vi.mock("@/shared/auth/session", () => ({
  requireSession: () => requireSessionMock(),
  requireRecentReauth: vi.fn(),
}));

const registrarVerificacionLibro = vi.fn();
vi.mock("@/modules/libro/infrastructure/incidente-integridad-repository", () => ({
  registrarVerificacionLibro: (...args: unknown[]) => registrarVerificacionLibro(...args),
}));

const invalidarResumenIntegridad = vi.fn();
vi.mock("@/modules/libro/application/resumen-integridad", () => ({
  invalidarResumenIntegridad: () => invalidarResumenIntegridad(),
}));

const logger = { error: vi.fn(), warn: vi.fn() };
const getLoggerMock = vi.fn(() => logger);
vi.mock("@/shared/logging/logger", () => ({ getLogger: () => getLoggerMock() }));

const { registrarIncidentesIntegridad, registrarIncidentesIntegridadCommand } = await import(
  "@/modules/libro/application/registrar-incidentes-integridad"
);
const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

beforeEach(() => {
  registrarVerificacionLibro.mockReset();
  logger.error.mockReset();
  logger.warn.mockReset();
  invalidarResumenIntegridad.mockReset();
  getLoggerMock.mockReset();
  getLoggerMock.mockImplementation(() => logger);
  requireSessionMock.mockReset();
  requireSessionMock.mockImplementation(async () => sessionWith(["libro.ver"]));
  withTenantTransactionMock.mockClear();
});

describe("libro.integridad.registrarIncidentes (command)", () => {
  it("declares permiso libro.ver and registers as a command", () => {
    expect(registrarIncidentesIntegridadCommand.name).toBe("libro.integridad.registrarIncidentes");
    expect(registrarIncidentesIntegridadCommand.permiso).toBe("libro.ver");
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "libro.integridad.registrarIncidentes");
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("command");
  });

  it("rejects a session without libro.ver with AuthorizationError", async () => {
    await expect(
      registrarIncidentesIntegridadCommand.execute({ libros: [{ libroId: LIBRO_A, quiebre: "3" }] }, { session: sessionWith([]) }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(registrarVerificacionLibro).not.toHaveBeenCalled();
  });

  it("calls the repository once per libro and lists only the ABIERTO transitions", async () => {
    registrarVerificacionLibro.mockImplementation(async (_tx: unknown, libroId: string) =>
      libroId === LIBRO_A ? { transicion: "ABIERTO", incidenteId: "inc-1" } : { transicion: "REPETIDO", incidenteId: "inc-2" },
    );

    const out = await registrarIncidentesIntegridadCommand.execute(
      {
        libros: [
          { libroId: LIBRO_A, quiebre: "3" },
          { libroId: LIBRO_B, quiebre: "9" },
        ],
      },
      { session: sessionWith(["libro.ver"]) },
    );

    expect(registrarVerificacionLibro).toHaveBeenCalledTimes(2);
    expect(registrarVerificacionLibro).toHaveBeenCalledWith(expect.anything(), LIBRO_A, "3");
    expect(registrarVerificacionLibro).toHaveBeenCalledWith(expect.anything(), LIBRO_B, "9");
    expect(out).toEqual({ tenantId: TENANT, abiertos: [{ libroId: LIBRO_A, quiebre: "3", incidenteId: "inc-1" }] });
  });

  it("passes a null quiebre (libro OK) to the repository and reports no incident for CERRADO / SIN_CAMBIO", async () => {
    registrarVerificacionLibro.mockResolvedValue({ transicion: "CERRADO", incidenteId: "inc-1" });
    const out = await registrarIncidentesIntegridadCommand.execute({ libros: [{ libroId: LIBRO_A, quiebre: null }] }, { session: sessionWith(["libro.ver"]) });

    expect(registrarVerificacionLibro).toHaveBeenCalledWith(expect.anything(), LIBRO_A, null);
    expect(out.abiertos).toEqual([]);
  });

  it("accepts at most 10 libros", async () => {
    const libros = Array.from({ length: 11 }, () => ({ libroId: LIBRO_A, quiebre: "1" }));
    await expect(registrarIncidentesIntegridadCommand.execute({ libros }, { session: sessionWith(["libro.ver"]) })).rejects.toThrow();
    expect(registrarVerificacionLibro).not.toHaveBeenCalled();
  });
});

describe("registrarIncidentesIntegridad (fail-soft wrapper)", () => {
  const verificacion = [
    { libroId: LIBRO_A, tipo: "RECETARIO" as const, quiebre: "3" },
    { libroId: LIBRO_B, tipo: "PSICOTROPICO" as const, quiebre: null },
  ];

  it("logs error with exactly { tenantId, libroTipo, quiebre, incidenteId } when an incident is newly opened", async () => {
    registrarVerificacionLibro.mockImplementation(async (_tx: unknown, libroId: string) =>
      libroId === LIBRO_A ? { transicion: "ABIERTO", incidenteId: "inc-1" } : { transicion: "SIN_CAMBIO", incidenteId: null },
    );

    await registrarIncidentesIntegridad(verificacion);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields] = logger.error.mock.calls[0]!;
    expect(fields).toEqual({ tenantId: TENANT, libroTipo: "RECETARIO", quiebre: "3", incidenteId: "inc-1" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not log error on REPETIDO", async () => {
    registrarVerificacionLibro.mockResolvedValue({ transicion: "REPETIDO", incidenteId: "inc-1" });

    await registrarIncidentesIntegridad(verificacion);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does nothing (no transaction) for an empty verification", async () => {
    await registrarIncidentesIntegridad([]);

    expect(withTenantTransactionMock).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("turns a thrown error into a warn and resolves", async () => {
    registrarVerificacionLibro.mockRejectedValue(new Error("db down"));

    await expect(registrarIncidentesIntegridad(verificacion)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("invalidates the summary cache when the registration fails, so the next navigation retries", async () => {
    registrarVerificacionLibro.mockRejectedValue(new Error("db down"));

    await registrarIncidentesIntegridad(verificacion);

    expect(invalidarResumenIntegridad).toHaveBeenCalledTimes(1);
  });

  it("invalidates the cache even when the logger is unavailable", async () => {
    registrarVerificacionLibro.mockRejectedValue(new Error("db down"));
    getLoggerMock.mockImplementation(() => {
      throw new Error("logger env not configured");
    });

    await registrarIncidentesIntegridad(verificacion);

    expect(invalidarResumenIntegridad).toHaveBeenCalledTimes(1);
  });

  it("does not invalidate the cache after a successful registration", async () => {
    registrarVerificacionLibro.mockResolvedValue({ transicion: "SIN_CAMBIO", incidenteId: null });

    await registrarIncidentesIntegridad(verificacion);

    expect(invalidarResumenIntegridad).not.toHaveBeenCalled();
  });

  it("rethrows a Next control-flow error (never swallows it)", async () => {
    let nextError: unknown;
    try {
      redirect("/login");
    } catch (e) {
      nextError = e;
    }
    requireSessionMock.mockRejectedValue(nextError);

    await expect(registrarIncidentesIntegridad(verificacion)).rejects.toBe(nextError);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(invalidarResumenIntegridad).not.toHaveBeenCalled();
  });

  it("does not propagate when the logger itself throws (getLogger throws)", async () => {
    registrarVerificacionLibro.mockRejectedValue(new Error("db down"));
    getLoggerMock.mockImplementation(() => {
      throw new Error("logger env not configured");
    });

    await expect(registrarIncidentesIntegridad(verificacion)).resolves.toBeUndefined();
  });

  it("does not propagate when logger.error throws after a successful commit", async () => {
    registrarVerificacionLibro.mockResolvedValue({ transicion: "ABIERTO", incidenteId: "inc-1" });
    logger.error.mockImplementation(() => {
      throw new Error("sink down");
    });

    await expect(registrarIncidentesIntegridad(verificacion)).resolves.toBeUndefined();
  });

  it("a session without libro.ver becomes a warn, not a throw", async () => {
    requireSessionMock.mockImplementation(async () => sessionWith([]));

    await expect(registrarIncidentesIntegridad(verificacion)).resolves.toBeUndefined();
    expect(registrarVerificacionLibro).not.toHaveBeenCalled();
  });
});
