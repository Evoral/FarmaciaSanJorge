/**
 * Unit tests for `app/(app)/cuenta/page.tsx` (commit 9b2d5db):
 * A cuenta de sector (session.sector) sees only a note and no password or PIN forms.
 * The huella panel (openspec/changes/metodos-verificacion-operador) is offered only to an individual, non-admin-only
 * session while the farmacia has the huella enabled; its state is read once per render.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";

const requireSessionMock = vi.fn();
vi.mock("@/shared/auth/session", () => ({
  requireSession: (...args: unknown[]) => requireSessionMock(...args),
}));

const estadoCredencialesMock = vi.fn();
vi.mock("@/modules/auth/application/estado-credenciales-operador", () => ({
  estadoCredencialesOperador: (...args: unknown[]) => estadoCredencialesMock(...args),
}));

const cuentaFormsMock = vi.fn(({ mostrarPin }: { mostrarPin: boolean; huella?: { enrolada: boolean } | null }) =>
  createElement("div", { "data-testid": "cuenta-forms", "data-mostrar-pin": String(mostrarPin) }, "FORMULARIO_DE_CUENTA"),
);
vi.mock("@/app/(app)/cuenta/cuenta-forms", () => ({
  CuentaForms: (props: { mostrarPin: boolean; huella?: { enrolada: boolean } | null }) => cuentaFormsMock(props),
}));

const { default: CuentaPage } = await import("@/app/(app)/cuenta/page");

const baseSession: AuthenticatedSession = {
  usuario: { id: "u-1", email: "u@example.com", nombre: "Nombre", apellido: "Apellido" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(["auth.login"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

beforeEach(() => {
  cuentaFormsMock.mockClear();
  estadoCredencialesMock.mockReset();
  estadoCredencialesMock.mockResolvedValue([{ metodo: "HUELLA", etiqueta: "Huella", habilitado: false, enrolada: false }]);
});

describe("CuentaPage (/cuenta)", () => {
  it("for a sector session: shows only an informative note, with NO password nor PIN forms", async () => {
    requireSessionMock.mockResolvedValue({
      ...baseSession,
      sector: { permisosConPin: new Set() },
    });

    const pageElement = await CuentaPage();
    const html = renderToStaticMarkup(pageElement);

    // Shows note
    expect(html).toContain('role="note"');
    expect(html).toContain(
      "Esta cuenta no tiene PIN ni cambia su contraseña: cada empleado se identifica con su propio PIN en las acciones que lo piden. La contraseña la define un Administrador desde Usuarios.",
    );
    expect(html).toContain("Cuenta de sector: una sesión compartida por el puesto de trabajo.");

    // Does NOT render CuentaForms
    expect(cuentaFormsMock).not.toHaveBeenCalled();
    expect(html).not.toContain("FORMULARIO_DE_CUENTA");
    // No huella panel for a cuenta de sector: its state is not even read.
    expect(estadoCredencialesMock).not.toHaveBeenCalled();
  });

  it("for a personal session (regular user): renders CuentaForms with mostrarPin = true", async () => {
    requireSessionMock.mockResolvedValue({
      ...baseSession,
      sector: undefined,
      soloAdministrador: false,
    });

    const pageElement = await CuentaPage();
    const html = renderToStaticMarkup(pageElement);

    // Does NOT show sector note
    expect(html).not.toContain('role="note"');
    expect(html).not.toContain("Esta cuenta no tiene PIN ni cambia su contraseña");

    // Renders CuentaForms with PIN enabled
    expect(cuentaFormsMock).toHaveBeenCalledWith(expect.objectContaining({ mostrarPin: true }));
    expect(html).toContain("FORMULARIO_DE_CUENTA");
    expect(html).toContain('data-mostrar-pin="true"');
  });

  it("for an admin-only personal session: renders CuentaForms with mostrarPin = false", async () => {
    requireSessionMock.mockResolvedValue({
      ...baseSession,
      sector: undefined,
      soloAdministrador: true,
    });

    const pageElement = await CuentaPage();
    const html = renderToStaticMarkup(pageElement);

    // Renders CuentaForms with PIN disabled
    expect(cuentaFormsMock).toHaveBeenCalledWith(expect.objectContaining({ mostrarPin: false }));
    expect(html).toContain('data-mostrar-pin="false"');
  });

  it("offers no huella panel while the farmacia has the huella disabled", async () => {
    requireSessionMock.mockResolvedValue({ ...baseSession, sector: undefined, soloAdministrador: false });

    renderToStaticMarkup(await CuentaPage());

    expect(cuentaFormsMock).toHaveBeenCalledWith(expect.objectContaining({ huella: null }));
  });

  it("offers the huella panel, with whether one is enrolled, when the huella is enabled", async () => {
    requireSessionMock.mockResolvedValue({ ...baseSession, sector: undefined, soloAdministrador: false });
    estadoCredencialesMock.mockResolvedValue([{ metodo: "HUELLA", etiqueta: "Huella", habilitado: true, enrolada: true }]);

    const html = renderToStaticMarkup(await CuentaPage());

    expect(cuentaFormsMock).toHaveBeenCalledWith(expect.objectContaining({ huella: { enrolada: true } }));
    expect(html).toContain("Tu contraseña, tu PIN y tu huella para confirmar acciones.");
  });

  it("never offers the huella panel to an Administrador-only session (it never acts as an operador)", async () => {
    requireSessionMock.mockResolvedValue({ ...baseSession, sector: undefined, soloAdministrador: true });
    estadoCredencialesMock.mockResolvedValue([{ metodo: "HUELLA", etiqueta: "Huella", habilitado: true, enrolada: false }]);

    renderToStaticMarkup(await CuentaPage());

    expect(cuentaFormsMock).toHaveBeenCalledWith(expect.objectContaining({ huella: null }));
    expect(estadoCredencialesMock).not.toHaveBeenCalled();
  });
});
