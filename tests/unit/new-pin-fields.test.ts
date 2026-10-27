/**
 * Unit tests for `modules/auth/ui/new-pin-fields.tsx` (commit 9b2d5db):
 * Shared PIN pair (pin / pinRepeat) with AUTH_POLICY constraints.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { NewPinFields } from "@/modules/auth/ui/new-pin-fields";
import { AUTH_POLICY } from "@/shared/auth/policy";

describe("NewPinFields", () => {
  it("renders default labels and 4-digit constraints for both PIN fields", () => {
    const html = renderToStaticMarkup(createElement(NewPinFields, {}));

    // Labels
    expect(html).toContain("Nuevo PIN");
    expect(html).toContain(`(${AUTH_POLICY.pinLength} dígitos)`);
    expect(html).toContain("Repetir PIN");

    // Inputs
    expect(html).toContain('id="pin"');
    expect(html).toContain('name="pin"');
    expect(html).toContain('id="pinRepeat"');
    expect(html).toContain('name="pinRepeat"');

    // Attributes
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain(`pattern="\\d{${AUTH_POLICY.pinLength}}"`);
    expect(html).toContain(`maxLength="${AUTH_POLICY.pinLength}"`);
    expect(html).toContain("required");
    expect(html).toContain('autoComplete="off"');
  });

  it("accepts custom label, repeatLabel, and autoFocus props", () => {
    const html = renderToStaticMarkup(
      createElement(NewPinFields, {
        label: "Ingresá tu PIN nuevo",
        repeatLabel: "Confirmá tu PIN nuevo",
        autoFocus: true,
      }),
    );

    expect(html).toContain("Ingresá tu PIN nuevo");
    expect(html).toContain("Confirmá tu PIN nuevo");
    expect(html).toContain("autofocus");
  });
});
