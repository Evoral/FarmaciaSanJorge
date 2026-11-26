/**
 * Server Actions of the «Huella» panel in `/cuenta` (openspec/changes/metodos-verificacion-operador) and the query that
 * feeds it. The actions stay thin: they forward the form to the credential use cases (mocked here) and turn the result
 * into the panel's state. The use cases themselves are covered by credencial-operador-casos-de-uso.test.ts.
 *
 *   - the code goes to the use case under its proof key (`huella`) and never comes back in the state;
 *   - an error keeps the use case's field so the form marks the control; success revalidates `/cuenta`;
 *   - neither action is wrapped in `conOperador` (an individual session, never an acción con PIN);
 *   - the query reports enablement and enrolment per self-enrolled method, booleans only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PERMISOS_CON_PIN_CONFIGURABLES, PERMISOS_CON_PIN_SIEMPRE } from "@/modules/auth/domain/permisos";
import { ValidationError } from "@/shared/errors";
import type { AuthenticatedSession } from "@/shared/auth/session";

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }));

const registrarMock = vi.fn(async (...args: unknown[]): Promise<void> => {
  void args;
});
const eliminarMock = vi.fn(async (...args: unknown[]): Promise<void> => {
  void args;
});
vi.mock("@/modules/auth/application/registrar-credencial-operador", () => ({ registrarCredencialOperador: (...args: unknown[]) => registrarMock(...args) }));
vi.mock("@/modules/auth/application/eliminar-credencial-operador", () => ({ eliminarCredencialOperador: (...args: unknown[]) => eliminarMock(...args) }));
vi.mock("@/modules/auth/application/cambiar-password", () => ({ cambiarPassword: vi.fn() }));
vi.mock("@/modules/auth/application/configurar-pin", () => ({ configurarPin: vi.fn() }));

const { registrarCredencialOperadorAction, eliminarCredencialOperadorAction } = await import("@/app/(app)/cuenta/actions");

const ESTADO_INICIAL = { message: null, success: false };
const CODIGO = "H-884213-secreto";

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  revalidatePathMock.mockClear();
  registrarMock.mockReset().mockResolvedValue(undefined);
  eliminarMock.mockReset().mockResolvedValue(undefined);
});

describe("registrarCredencialOperadorAction", () => {
  it("forwards method, current password and the code under its proof key, then revalidates /cuenta", async () => {
    const estado = await registrarCredencialOperadorAction(ESTADO_INICIAL, form({ metodo: "HUELLA", passwordActual: "Clave-actual-1", huella: CODIGO }));

    expect(registrarMock).toHaveBeenCalledWith({ metodo: "HUELLA", passwordActual: "Clave-actual-1", huella: CODIGO });
    expect(revalidatePathMock).toHaveBeenCalledWith("/cuenta");
    expect(estado.success).toBe(true);
    expect(JSON.stringify(estado)).not.toContain(CODIGO);
  });

  it("returns the use case's message and the field to mark, without revalidating and without echoing the code", async () => {
    registrarMock.mockRejectedValue(new ValidationError("Ese código no se puede usar. Probá con otro.", { fields: ["huella"] }));

    const estado = await registrarCredencialOperadorAction(ESTADO_INICIAL, form({ metodo: "HUELLA", passwordActual: "Clave-actual-1", huella: CODIGO }));

    expect(estado).toEqual({ message: "Ese código no se puede usar. Probá con otro.", success: false, fields: ["huella"] });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(JSON.stringify(estado)).not.toContain(CODIGO);
  });

  it("sends empty strings for missing fields, so the use case rejects them with its own Spanish messages", async () => {
    await registrarCredencialOperadorAction(ESTADO_INICIAL, form({ metodo: "HUELLA" }));

    expect(registrarMock).toHaveBeenCalledWith({ metodo: "HUELLA", passwordActual: "", huella: "" });
  });
});

describe("eliminarCredencialOperadorAction", () => {
  it("removes the own code of the method and revalidates /cuenta", async () => {
    const estado = await eliminarCredencialOperadorAction(ESTADO_INICIAL, form({ metodo: "HUELLA" }));

    expect(eliminarMock).toHaveBeenCalledWith({ metodo: "HUELLA" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/cuenta");
    expect(estado.success).toBe(true);
  });

  it("returns the failure message without revalidating", async () => {
    eliminarMock.mockRejectedValue(new ValidationError("No tenés el método Huella configurado."));

    const estado = await eliminarCredencialOperadorAction(ESTADO_INICIAL, form({ metodo: "HUELLA" }));

    expect(estado).toEqual({ message: "No tenés el método Huella configurado.", success: false });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("the actions are not acciones con PIN", () => {
  it("neither credential use case permiso is gated by the operador PIN dialog", () => {
    const conPin = new Set<string>([...PERMISOS_CON_PIN_CONFIGURABLES, ...PERMISOS_CON_PIN_SIEMPRE]);
    expect(conPin.has("auth.password.cambiar")).toBe(false);
    expect(conPin.has("usuarios.credencial.restablecer")).toBe(false);
  });
});

describe("auth.credencialOperador.estado", () => {
  const TENANT_ID = "11111111-1111-1111-1111-111111111111";
  const USUARIO_ID = "22222222-2222-4222-a222-222222222222";

  const loadMetodosHabilitadosMock = vi.fn();
  const loadMetodosConCredencialMock = vi.fn();

  function sesion(): AuthenticatedSession {
    return {
      usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
      tenantId: TENANT_ID,
      sesionId: "s1",
      permisos: new Set(["auth.password.cambiar"]) as AuthenticatedSession["permisos"],
      reautenticadaEn: new Date(),
    };
  }

  async function consultar() {
    vi.resetModules();
    vi.doMock("@/shared/audit", () => ({ record: vi.fn(), TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }) }));
    vi.doMock("@/shared/db/transaction", () => ({ withTenantTransaction: async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ tenantId }) }));
    vi.doMock("@/modules/auth/infrastructure/session-repository", () => ({ loadMetodosHabilitados: (...args: unknown[]) => loadMetodosHabilitadosMock(...args) }));
    vi.doMock("@/modules/auth/infrastructure/credencial-operador-repository", () => ({ loadMetodosConCredencial: (...args: unknown[]) => loadMetodosConCredencialMock(...args) }));
    const { estadoCredencialesOperadorQuery } = await import("@/modules/auth/application/estado-credenciales-operador");
    return estadoCredencialesOperadorQuery.execute({}, { session: sesion() });
  }

  it("says HUELLA is off and not enrolled by default", async () => {
    loadMetodosHabilitadosMock.mockResolvedValue(new Set(["PIN"]));
    loadMetodosConCredencialMock.mockResolvedValue([]);

    expect(await consultar()).toEqual([{ metodo: "HUELLA", etiqueta: "Huella", habilitado: false, enrolada: false }]);
  });

  it("keeps an enrolled huella visible as enrolled even while the method is off (disabling keeps the codes)", async () => {
    loadMetodosHabilitadosMock.mockResolvedValue(new Set(["PIN"]));
    loadMetodosConCredencialMock.mockResolvedValue(["HUELLA"]);

    expect(await consultar()).toEqual([{ metodo: "HUELLA", etiqueta: "Huella", habilitado: false, enrolada: true }]);
  });

  it("reads only the session's own usuario and returns booleans, never a hash", async () => {
    loadMetodosHabilitadosMock.mockResolvedValue(new Set(["PIN", "HUELLA"]));
    loadMetodosConCredencialMock.mockResolvedValue(["HUELLA"]);

    const estado = await consultar();

    expect(loadMetodosConCredencialMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, USUARIO_ID);
    expect(estado).toEqual([{ metodo: "HUELLA", etiqueta: "Huella", habilitado: true, enrolada: true }]);
  });
});
