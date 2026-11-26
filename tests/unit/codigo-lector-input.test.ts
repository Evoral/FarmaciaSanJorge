/**
 * `CodigoLectorInput` masking (openspec/changes/metodos-verificacion-operador): CSS masking where the browser honours
 * `-webkit-text-security`, a `type="password"` fallback where it does not (Firefox), so the code is never shown in clear.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it, expect, vi } from "vitest";
import { CodigoLectorInput, soportaEnmascaradoCss } from "@/shared/ui/codigo-lector-input";

afterEach(() => vi.unstubAllGlobals());

describe("soportaEnmascaradoCss", () => {
  it("is true when the browser supports -webkit-text-security", () => {
    const supports = vi.fn(() => true);
    vi.stubGlobal("CSS", { supports });

    expect(soportaEnmascaradoCss()).toBe(true);
    expect(supports).toHaveBeenCalledWith("-webkit-text-security", "disc");
  });

  it("is false when it does not (Firefox)", () => {
    vi.stubGlobal("CSS", { supports: () => false });

    expect(soportaEnmascaradoCss()).toBe(false);
  });

  it("is false when the CSS API is missing", () => {
    vi.stubGlobal("CSS", undefined);

    expect(soportaEnmascaradoCss()).toBe(false);
  });
});

describe("CodigoLectorInput", () => {
  it("renders as masked text on the server (the hydration render assumes support) with every password manager opt-out", () => {
    const html = renderToStaticMarkup(createElement(CodigoLectorInput, { name: "huella" }));

    expect(html).toContain('type="text"');
    expect(html).toContain("-webkit-text-security");
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("data-1p-ignore");
  });
});
