/**
 * modules/plataforma (openspec/specs/plataforma/spec.md P5, P6, P10): the guard runs before anything else, the
 * alta validates and maps conflicts to fields, the plaintext password never reaches the repository, and proxy.ts asks
 * for the platform cookie on /plataforma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const requireSuperAdminMock = vi.fn(async (): Promise<unknown> => ({ superadminId: "sa", email: "ops@x.com", nombre: "Ops", tokenHash: "hash-del-token" }));
vi.mock("@/shared/auth/plataforma", () => ({ requireSuperAdmin: () => requireSuperAdminMock() }));

const withPlatformTransactionMock = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ __platform: true }));
vi.mock("@/shared/db/transaction", () => ({ withPlatformTransaction: (fn: (tx: unknown) => unknown) => withPlatformTransactionMock(fn) }));
vi.mock("@/shared/audit/request-context", () => ({ getRequestContext: async () => ({ ip: null, userAgent: null, requestId: "req" }) }));

const hashPasswordMock = vi.fn(async (...args: unknown[]): Promise<string> => {
  void args;
  return "argon2-hash";
});
vi.mock("@/modules/auth/domain/password", () => ({ hashPassword: (...args: unknown[]) => hashPasswordMock(...args) }));

const repo = {
  listarFarmacias: vi.fn(async () => ({ items: [], total: 0 })),
  verFarmacia: vi.fn(async () => null),
  auditoriaFarmacia: vi.fn(async () => []),
  conflictosDeAlta: vi.fn(async () => ({ cuit: false, email: false })),
  crearFarmacia: vi.fn(async (...args: unknown[]) => {
    void args;
    return { tenantId: "t-1" };
  }),
  cambiarEstadoFarmacia: vi.fn(async () => undefined),
  editarContactoFarmacia: vi.fn(async () => undefined),
  cuentaCorriente: vi.fn(async () => ({ movimientos: [], saldo: "0.00" })),
  registrarCargo: vi.fn(async (...args: unknown[]) => {
    void args;
    return "c-1";
  }),
  registrarPago: vi.fn(async (...args: unknown[]) => {
    void args;
    return "p-1";
  }),
  anularMovimiento: vi.fn(async () => undefined),
};
vi.mock("@/modules/plataforma/infrastructure/plataforma-repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/plataforma/infrastructure/plataforma-repository")>("@/modules/plataforma/infrastructure/plataforma-repository");
  return { ...repo, campoDeConflictoDeAlta: actual.campoDeConflictoDeAlta };
});

const { listarFarmacias } = await import("@/modules/plataforma/application/listar-farmacias");
const { verFarmacia } = await import("@/modules/plataforma/application/ver-farmacia");
const { crearFarmacia } = await import("@/modules/plataforma/application/crear-farmacia");
const { cambiarEstadoFarmacia } = await import("@/modules/plataforma/application/cambiar-estado-farmacia");
const { editarContactoFarmacia } = await import("@/modules/plataforma/application/editar-contacto-farmacia");
const { registrarCargo, registrarPago, anularMovimiento } = await import("@/modules/plataforma/application/cuenta-corriente");
const { AuthenticationError, ValidationError } = await import("@/shared/errors");
const { proxy } = await import("@/proxy");

const ID = "11111111-1111-4111-8111-111111111111";
const ALTA = {
  razonSocial: "Farmacia Uno S.R.L.",
  cuit: "30-71234567-1",
  adminEmail: "ADMIN@uno.com",
  adminNombre: "Ana",
  adminApellido: "Pérez",
  adminDni: "30.123.456",
  adminPasswordTemporal: "temporal1",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdminMock.mockResolvedValue({ superadminId: "sa", email: "ops@x.com", nombre: "Ops", tokenHash: "hash-del-token" });
  repo.conflictosDeAlta.mockResolvedValue({ cuit: false, email: false });
});

describe("platform use cases: requireSuperAdmin is the first gate", () => {
  const llamadas: [string, () => Promise<unknown>][] = [
    ["listarFarmacias", () => listarFarmacias({})],
    ["verFarmacia", () => verFarmacia(ID)],
    ["crearFarmacia", () => crearFarmacia(ALTA)],
    ["cambiarEstadoFarmacia", () => cambiarEstadoFarmacia({ id: ID, estado: "SUSPENDIDO", motivo: "falta de pago" })],
    ["editarContactoFarmacia", () => editarContactoFarmacia({ id: ID, contactoNombre: "X" })],
    ["registrarCargo", () => registrarCargo({ tenantId: ID, periodo: "2026-11", monto: "1000", concepto: "Abono" })],
    ["registrarPago", () => registrarPago({ tenantId: ID, fecha: "2026-01-01", monto: "1000", medio: "EFECTIVO", envioId: ID })],
    ["anularMovimiento", () => anularMovimiento({ tipo: "PAGO", id: ID, motivo: "error" })],
  ];

  it.each(llamadas)("%s: without a superadmin nothing else runs", async (_nombre, llamar) => {
    requireSuperAdminMock.mockRejectedValueOnce(new AuthenticationError());
    await expect(llamar()).rejects.toBeInstanceOf(AuthenticationError);
    expect(withPlatformTransactionMock).not.toHaveBeenCalled();
    expect(hashPasswordMock).not.toHaveBeenCalled();
  });

  it("every repository call gets the session's token hash", async () => {
    await listarFarmacias({ busqueda: "uno", pagina: 2 });
    expect(repo.listarFarmacias).toHaveBeenCalledWith({ __platform: true }, "hash-del-token", { busqueda: "uno", limit: 25, offset: 25 });
  });
});

describe("crearFarmacia", () => {
  it("hashes the temporary password and never passes the plaintext down", async () => {
    await crearFarmacia(ALTA);
    expect(hashPasswordMock).toHaveBeenCalledWith("temporal1");
    const alta = repo.crearFarmacia.mock.calls[0]![2] as Record<string, unknown>;
    expect(alta.adminPasswordHash).toBe("argon2-hash");
    expect(JSON.stringify(repo.crearFarmacia.mock.calls[0])).not.toContain("temporal1");
    expect(alta.adminEmail).toBe("admin@uno.com");
    expect(alta.adminDni).toBe("30123456");
  });

  it("an invalid CUIT check digit marks the cuit field and touches nothing", async () => {
    await expect(crearFarmacia({ ...ALTA, cuit: "30-71234567-2" })).rejects.toMatchObject({ fields: ["cuit"] });
    expect(withPlatformTransactionMock).not.toHaveBeenCalled();
  });

  it("a CUIT or email already in use marks its field, nothing is created", async () => {
    repo.conflictosDeAlta.mockResolvedValueOnce({ cuit: true, email: false });
    await expect(crearFarmacia(ALTA)).rejects.toMatchObject({ fields: ["cuit"] });
    repo.conflictosDeAlta.mockResolvedValueOnce({ cuit: false, email: true });
    await expect(crearFarmacia(ALTA)).rejects.toMatchObject({ fields: ["adminEmail"] });
    expect(repo.crearFarmacia).not.toHaveBeenCalled();
  });

  it("a unique violation in the race maps to the field", async () => {
    repo.crearFarmacia.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "tenant_cuit_key"'));
    const error = await crearFarmacia(ALTA).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as InstanceType<typeof ValidationError>).fields).toEqual(["cuit"]);
  });

  it("a temporary password shorter than the policy is refused", async () => {
    await expect(crearFarmacia({ ...ALTA, adminPasswordTemporal: "abc" })).rejects.toMatchObject({ fields: ["adminPasswordTemporal"] });
  });
});

describe("cambiarEstadoFarmacia", () => {
  it("suspending needs a motivo; reactivating does not", async () => {
    await expect(cambiarEstadoFarmacia({ id: ID, estado: "SUSPENDIDO", motivo: "  " })).rejects.toMatchObject({ fields: ["motivo"] });
    await cambiarEstadoFarmacia({ id: ID, estado: "ACTIVO" });
    expect(repo.cambiarEstadoFarmacia).toHaveBeenCalledWith({ __platform: true }, "hash-del-token", ID, "ACTIVO", null, { ip: null, requestId: "req" });
  });
});

describe("cuenta corriente (P13-P15)", () => {
  it("a cargo: the month becomes its first day, the monto a 2-decimal string (es-AR input)", async () => {
    await registrarCargo({ tenantId: ID, periodo: "2026-11", monto: "12.500,5", concepto: " Abono mensual " });
    expect(repo.registrarCargo.mock.calls[0]![2]).toEqual({ tenantId: ID, periodo: "2026-11-01", monto: "12500.50", concepto: "Abono mensual" });
  });

  it("a monto with 3 decimals, zero or negative is refused on the monto field", async () => {
    for (const monto of ["10,555", "0", "-5"]) {
      await expect(registrarCargo({ tenantId: ID, periodo: "2026-11", monto, concepto: "Abono" })).rejects.toMatchObject({ fields: ["monto"] });
    }
    expect(repo.registrarCargo).not.toHaveBeenCalled();
  });

  it("a duplicate cargo (INV-PLAT-CARGO-DUPLICADO from the DB) marks período and concepto", async () => {
    repo.registrarCargo.mockRejectedValueOnce(new Error("INV-PLAT-CARGO-DUPLICADO: ya hay un cargo con ese período y concepto"));
    await expect(registrarCargo({ tenantId: ID, periodo: "2026-11", monto: "1", concepto: "Abono" })).rejects.toMatchObject({ fields: ["periodo", "concepto"] });
  });

  it("a pago dated after today in Buenos Aires is refused, even at 23:30 local", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T02:30:00Z")); // 23:30 of 2026-11-09 in Buenos Aires
    try {
      await expect(registrarPago({ tenantId: ID, fecha: "2026-11-10", monto: "1", medio: "EFECTIVO", envioId: ID })).rejects.toMatchObject({ fields: ["fecha"] });
      await registrarPago({ tenantId: ID, fecha: "2026-11-09", monto: "1", medio: "EFECTIVO", envioId: ID });
      expect(repo.registrarPago).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("anular needs a motivo", async () => {
    await expect(anularMovimiento({ tipo: "CARGO", id: ID, motivo: " " })).rejects.toMatchObject({ fields: ["motivo"] });
    expect(repo.anularMovimiento).not.toHaveBeenCalled();
  });
});

describe("proxy.ts: the cookie each path needs (P5)", () => {
  function pedir(path: string, cookies: Record<string, string>) {
    const request = new NextRequest(new URL(path, "https://fsj.test"));
    for (const [nombre, valor] of Object.entries(cookies)) request.cookies.set(nombre, valor);
    return proxy(request);
  }
  const esRedirectALogin = (response: Response) => response.status === 307 && (response.headers.get("location") ?? "").endsWith("/login");

  it("/plataforma passes with either cookie (the layout answers notFound to a pharmacy user) and redirects with none", () => {
    expect(esRedirectALogin(pedir("/plataforma", {}))).toBe(true);
    expect(esRedirectALogin(pedir("/plataforma", { fsj_session: "x" }))).toBe(false);
    expect(esRedirectALogin(pedir("/plataforma/farmacias/nueva", { fsj_plataforma: "x" }))).toBe(false);
  });

  it("pharmacy paths still need fsj_session; the platform cookie is not enough", () => {
    expect(esRedirectALogin(pedir("/recetas", { fsj_plataforma: "x" }))).toBe(true);
    expect(esRedirectALogin(pedir("/recetas", { fsj_session: "x" }))).toBe(false);
  });

  it("a lookalike path is not the panel", () => {
    expect(esRedirectALogin(pedir("/plataformas", { fsj_plataforma: "x" }))).toBe(true);
  });
});
