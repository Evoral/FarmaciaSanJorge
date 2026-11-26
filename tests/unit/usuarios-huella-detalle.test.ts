/**
 * Usuarios › detalle, huella section (openspec/changes/metodos-verificacion-operador): the Administrador sees only
 * WHETHER a huella is enrolled (method names, never the hash) and can remove it. The use case itself is covered by
 * credencial-operador-casos-de-uso.test.ts; here the Server Action and the detail read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StepUpRequiredError, ValidationError } from "@/shared/errors";

const eliminarMock = vi.fn(async (...args: unknown[]): Promise<void> => {
  void args;
});
vi.mock("@/modules/usuarios/application/eliminar-credencial-operador", () => ({ eliminarCredencialOperadorDeUsuario: (...args: unknown[]) => eliminarMock(...args) }));
vi.mock("@/modules/usuarios/application/editar-usuario", () => ({}));
vi.mock("@/modules/usuarios/application/cambiar-roles", () => ({}));
vi.mock("@/modules/usuarios/application/suspender-usuario", () => ({}));
vi.mock("@/modules/usuarios/application/reactivar-usuario", () => ({}));
vi.mock("@/modules/usuarios/application/dar-de-baja-usuario", () => ({}));
vi.mock("@/modules/usuarios/application/restablecer-credencial", () => ({}));
vi.mock("@/modules/usuarios/application/restablecer-pin", () => ({}));

const { eliminarCredencialOperadorAction } = await import("@/modules/usuarios/ui/actions");
const { getUsuarioDetalle } = await import("@/modules/usuarios/infrastructure/usuario-repository");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-4222-a222-222222222222";

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  eliminarMock.mockReset().mockResolvedValue(undefined);
});

describe("eliminarCredencialOperadorAction (Administrador)", () => {
  it("forwards the target usuario and the method, and confirms", async () => {
    const estado = await eliminarCredencialOperadorAction({ status: "idle" }, form({ usuarioId: USUARIO_ID, metodo: "HUELLA" }));

    expect(eliminarMock).toHaveBeenCalledWith({ usuarioId: USUARIO_ID, metodo: "HUELLA" });
    expect(estado).toEqual({ status: "success", message: "Huella eliminada." });
  });

  it("surfaces the use case's message when it fails", async () => {
    eliminarMock.mockRejectedValue(new ValidationError("El usuario no tiene el método Huella configurado."));

    const estado = await eliminarCredencialOperadorAction({ status: "idle" }, form({ usuarioId: USUARIO_ID, metodo: "HUELLA" }));

    expect(estado).toMatchObject({ status: "error", message: "El usuario no tiene el método Huella configurado." });
  });

  it("asks for a recent re-authentication like the other sensitive admin actions", async () => {
    eliminarMock.mockRejectedValue(new StepUpRequiredError());

    expect(await eliminarCredencialOperadorAction({ status: "idle" }, form({ usuarioId: USUARIO_ID, metodo: "HUELLA" }))).toEqual({ status: "reauth-required" });
  });
});

describe("getUsuarioDetalle: credencialesOperador", () => {
  function tx(credenciales: { metodo: string }[]) {
    const findUnique = vi.fn(async (...args: unknown[]) => {
      void args;
      return {
        id: USUARIO_ID,
        nombre: "N",
        apellido: "A",
        email: "u@example.com",
        dni: "1",
        estado: "ACTIVO",
        numeroMatricula: null,
        creadoEn: new Date(),
        ultimoAcceso: null,
        fechaBaja: null,
        motivoBaja: null,
        esTecnico: false,
        esSector: false,
        pinHash: "pin-hash",
        pinBloqueado: false,
        credencialesOperador: credenciales,
        rolesAsignados: [],
      };
    });
    return { findUnique, tx: { usuario: { findUnique } } as never };
  }

  it("lists the methods the usuario holds a code for", async () => {
    const { tx: fake } = tx([{ metodo: "HUELLA" }]);

    expect((await getUsuarioDetalle(fake, TENANT_ID, USUARIO_ID))?.credencialesOperador).toEqual(["HUELLA"]);
  });

  it("selects only the method of each credential: the hash is never read", async () => {
    const { findUnique, tx: fake } = tx([]);

    await getUsuarioDetalle(fake, TENANT_ID, USUARIO_ID);

    const arg = findUnique.mock.calls[0]![0] as { select: { credencialesOperador: unknown } };
    expect(arg.select.credencialesOperador).toEqual({ select: { metodo: true } });
  });
});
