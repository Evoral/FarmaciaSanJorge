/**
 * Layout and rejected-code behavior of the `/cuenta` forms (openspec/changes/metodos-verificacion-operador).
 *
 *   - a container query cannot style its own container: the `@container` element and the `@3xl:grid-cols-2` grid are two
 *     different elements, the grid being the container's child (the panels sit side by side where there is room);
 *   - a rejected huella code is emptied and focused so the reader's next scan does not append to it, while every other
 *     field of the form is left alone.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { clearRejectedField } from "@/shared/ui/field-errors";

vi.mock("@/app/(app)/cuenta/actions", () => ({
  cambiarPasswordAction: vi.fn(),
  configurarPinAction: vi.fn(),
  eliminarCredencialOperadorAction: vi.fn(),
  registrarCredencialOperadorAction: vi.fn(),
}));

const { CuentaForms } = await import("@/app/(app)/cuenta/cuenta-forms");

/** The opening tags of the elements carrying `fragmento` in their class list. */
function etiquetasConClase(html: string, fragmento: string): string[] {
  return (html.match(/<[a-z]+ [^>]*class="[^"]*"[^>]*>/g) ?? []).filter(
    (etiqueta) => etiqueta.includes(fragmento),
  );
}

describe("CuentaForms layout", () => {
  it("puts the container query on a wrapper and the two-column grid on its child", () => {
    const html = renderToStaticMarkup(
      createElement(CuentaForms, {
        mostrarPin: true,
        huella: { enrolada: false },
      }),
    );

    const grids = etiquetasConClase(html, "@3xl:grid-cols-2");
    expect(grids).toHaveLength(1);
    // The grid is NOT itself the container (it would never match its own query)...
    expect(grids[0]).not.toContain("@container");
    // ...and it sits directly inside the element that is.
    expect(html).toMatch(
      /<div class="@container"><div class="grid [^"]*@3xl:grid-cols-2/,
    );
  });

  it("stays a single column when there is no PIN nor huella panel", () => {
    const html = renderToStaticMarkup(
      createElement(CuentaForms, { mostrarPin: false, huella: null }),
    );

    expect(etiquetasConClase(html, "@3xl:grid-cols-2")).toHaveLength(0);
    expect(html).toContain('<div class="@container"><div class="grid ');
  });
});

describe("clearRejectedField", () => {
  function formulario(valores: Record<string, string>) {
    const controles: Record<
      string,
      { value: string; focus: ReturnType<typeof vi.fn> }
    > = {};
    for (const [nombre, valor] of Object.entries(valores))
      controles[nombre] = { value: valor, focus: vi.fn() };
    return {
      controles,
      form: {
        elements: { namedItem: (nombre: string) => controles[nombre] ?? null },
      } as unknown as HTMLFormElement,
    };
  }

  it("empties and focuses the rejected code and keeps the other fields", () => {
    const { controles, form } = formulario({
      huella: "H-884213",
      passwordActual: "secreta",
    });

    expect(clearRejectedField(form, ["huella"], "huella")).toBe(true);

    expect(controles.huella!.value).toBe("");
    expect(controles.huella!.focus).toHaveBeenCalledOnce();
    expect(controles.passwordActual!.value).toBe("secreta");
    expect(controles.passwordActual!.focus).not.toHaveBeenCalled();
  });

  it("leaves the code alone when the error points at another field (e.g. a wrong password)", () => {
    const { controles, form } = formulario({
      huella: "H-884213",
      passwordActual: "mala",
    });

    expect(clearRejectedField(form, ["passwordActual"], "huella")).toBe(false);
    expect(clearRejectedField(form, undefined, "huella")).toBe(false);

    expect(controles.huella!.value).toBe("H-884213");
    expect(controles.huella!.focus).not.toHaveBeenCalled();
  });
});
