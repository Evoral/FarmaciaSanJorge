/**
 * The huella in the verification dialog and its enablement toggle (openspec/changes/metodos-verificacion-operador),
 * checked through the client registry's markup (no DOM environment here: the dialog's behavior -- focus, Enter, retry on
 * the last method, double Enter -- is in the manual checklist of the PR).
 *
 *   - the huella field never echoes the code, never asks the browser to remember it and is marked after a rejection;
 *   - it outranks the PIN, so a farmacia with both opens on the huella;
 *   - the admin toggle carries the reader setup note; the PIN carries none.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/auth/ui/reauth-aware-form", () => ({ ReauthAwareForm: () => null }));
vi.mock("@/modules/operadores/ui/actions", () => ({ configurarMetodosVerificacionAction: vi.fn(), configurarAccionesConPinAction: vi.fn() }));

const { METODOS_EN_DIALOGO } = await import("@/modules/operadores/ui/metodos-en-dialogo");
const { MetodosVerificacionForm } = await import("@/modules/operadores/ui/metodos-verificacion-form");

function campoHuella(propios: { invalido?: boolean; enviado?: boolean; valores?: Record<string, string> } = {}): string {
  const { Campo } = METODOS_EN_DIALOGO.HUELLA;
  return renderToStaticMarkup(
    createElement(Campo as never, { id: "campo", ref: null, valores: propios.valores ?? {}, onChange: () => undefined, invalido: propios.invalido ?? false, enviado: propios.enviado ?? false }),
  );
}

describe("HUELLA field in the dialog", () => {
  it("is masked text that opts out of autofill and password managers", () => {
    const html = campoHuella();

    expect(html).not.toContain('type="password"');
    expect(html).toContain('type="text"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("data-1p-ignore");
    expect(html).toContain('data-lpignore="true"');
    expect(html).toContain("-webkit-text-security");
    expect(html).toContain('spellCheck="false"');
  });

  it("is marked invalid only after a rejection, and read-only once the code was sent (a reader's second Enter)", () => {
    expect(campoHuella()).not.toContain("aria-invalid");
    expect(campoHuella({ invalido: true })).toContain('aria-invalid="true"');
    expect(campoHuella({ enviado: true })).toContain('readOnly=""');
    expect(campoHuella()).not.toContain('readOnly=""');
  });

  it("is a controlled field on the `huella` proof key", () => {
    expect(campoHuella({ valores: { huella: "H-884213" } })).toContain('value="H-884213"');
  });
});

describe("dialog priority", () => {
  it("opens on the huella before the PIN when both are enabled", () => {
    expect(METODOS_EN_DIALOGO.HUELLA.prioridad).toBeGreaterThan(METODOS_EN_DIALOGO.PIN.prioridad);
  });
});

describe("MetodosVerificacionForm (read-only rendering)", () => {
  it("shows the huella toggle with the reader setup note", () => {
    const html = renderToStaticMarkup(createElement(MetodosVerificacionForm, { metodos: [{ metodo: "HUELLA", etiqueta: "Huella", habilitado: false }], disabled: true }));

    expect(html).toContain("Huella: habilitado");
    expect(html).toContain("termina con Enter");
    expect(html).toContain("se guarda solo como hash");
  });

  it("has no setup note for the PIN", () => {
    expect(METODOS_EN_DIALOGO.PIN.notaDeConfiguracion).toBeUndefined();
  });
});
