/**
 * Unit tests for `app/(app)/cuenta/page.tsx` (commit 9b2d5db):
 * A cuenta de sector (session.sector) sees only a note and no password or PIN forms.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";

const requireSessionMock = vi.fn();
vi.mock("@/shared/auth/session", () => ({
  requireSession: (...args: unknown[]) => requireSessionMock(...args),
}));

const cuentaFormsMock = vi.fn(({ mostrarPin }: { mostrarPin: boolean }) =>
  createElement("div", { "data-testid": "cuenta-forms", "data-mostrar-pin": String(mostrarPin) }, "FORMULARIO_DE_CUENTA"),
);
vi.mock("@/app/(app)/cuenta/cuenta-forms", () => ({
  CuentaForms: (props: any) => cuentaFormsMock(props),
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
});
