import { createElement, type ComponentProps } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

const useStateMock = vi.fn();

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: any) => useStateMock(initial, actual.useState),
  };
});

const { PasswordInput } = await import("@/shared/ui/password-input");

beforeEach(() => {
  useStateMock.mockImplementation((initial, original) => original(initial));
});

describe("PasswordInput", () => {
  it("renders with type='password', aria-label='Mostrar clave', aria-pressed=false by default", () => {
    const html = renderToStaticMarkup(createElement(PasswordInput, { id: "pass", name: "password" }));
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="Mostrar clave"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-controls="pass"');
    expect(html).toContain('title="Mostrar"');
  });

  it("renders with type='text', aria-label='Ocultar clave', aria-pressed=true when visible is true", () => {
    useStateMock.mockImplementation(() => [true, vi.fn()]);
    const html = renderToStaticMarkup(createElement(PasswordInput, { id: "pass", name: "password" }));
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-label="Ocultar clave"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('title="Ocultar"');
  });

  it("toggles visible state on button click", () => {
    let stateUpdater: ((prev: boolean) => boolean) | undefined;
    const setVisible = vi.fn((fn: any) => {
      if (typeof fn === "function") {
        stateUpdater = fn;
      }
    });
    useStateMock.mockImplementation(() => [false, setVisible]);

    // Render inside a wrapper or call renderToStaticMarkup
    let capturedElement: any = null;
    function Wrapper() {
      capturedElement = createElement(PasswordInput, { id: "pass", name: "password" });
      return capturedElement;
    }
    renderToStaticMarkup(createElement(Wrapper));

    // PasswordInput returned JSX: find the button in the rendered element
    const rendered = PasswordInput({ id: "pass", name: "password" });
    const button = rendered.props.children[1];
    button.props.onClick();

    expect(setVisible).toHaveBeenCalledTimes(1);
    expect(stateUpdater).toBeDefined();
    expect(stateUpdater!(false)).toBe(true);
    expect(stateUpdater!(true)).toBe(false);
  });

  it("defaults className to 'input w-full pr-10' when className is not provided", () => {
    const html = renderToStaticMarkup(createElement(PasswordInput, { id: "pass" }));
    expect(html).toContain('class="input w-full pr-10"');
  });

  it("keeps custom className and appends 'w-full pr-10'", () => {
    const html = renderToStaticMarkup(createElement(PasswordInput, { className: "custom-field bg-white" }));
    expect(html).toContain('class="custom-field bg-white w-full pr-10"');
  });

  it("forwards standard input props (placeholder, disabled, autoComplete, inputMode, maxLength) to the input", () => {
    const html = renderToStaticMarkup(
      createElement(PasswordInput, {
        id: "pin-input",
        name: "pin",
        placeholder: "Ingrese su clave",
        disabled: true,
        autoComplete: "off",
        inputMode: "numeric",
        maxLength: 4,
      }),
    );
    expect(html).toContain('id="pin-input"');
    expect(html).toContain('name="pin"');
    expect(html).toContain('placeholder="Ingrese su clave"');
    expect(html).toContain("disabled");
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('maxLength="4"');
  });

  it("forwards ref to the input element", () => {
    const ref = { current: null };
    useStateMock.mockImplementation(() => [false, vi.fn()]);
    const element = PasswordInput({ ref, id: "pass" });
    const input = element.props.children[0];
    expect(input.props.ref).toBe(ref);
  });
});
