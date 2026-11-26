"use client";

import { useSyncExternalStore, type ComponentProps } from "react";

/** Whether the browser masks a plain text input through `-webkit-text-security` (Chromium, Safari; not Firefox). */
export function soportaEnmascaradoCss(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("-webkit-text-security", "disc");
}

const sinSuscripcion = () => () => undefined;

/**
 * The input a keyboard-wedge reader types a secret code into (the huella): the reader "types" the code and presses
 * Enter, so the form submits by itself.
 *
 * Why not `<input type="password">` first: browsers and password managers offer to save, fill or generate a value for any
 * password field, and a stored huella code would defeat the point. So where the browser supports it this is a plain text
 * input whose characters are masked with CSS (`-webkit-text-security`), plus every opt-out the common managers honour.
 * A browser without that property (Firefox) would show the code in clear, so there the input falls back to
 * `type="password"` (same opt-outs: a masked field beats a visible code). The support check runs on the client only:
 * the server and the hydration render assume support, and the type flips right after mount where it is missing (the
 * node stays, so typed text and focus survive).
 *
 * Residual: a CSS-masked field is still a text input, so Ctrl+C on a selected value copies the code in clear. The value
 * is never echoed anywhere else on the page.
 *
 * No show/hide toggle (unlike `./password-input.tsx`): nobody can read a scanned code, and a toggle is one more tab stop
 * between the reader and the Enter key. Every other prop (ref included) goes to the input.
 */
export function CodigoLectorInput({ className, ...props }: Omit<ComponentProps<"input">, "type" | "autoComplete">) {
  const enmascaradoCss = useSyncExternalStore(sinSuscripcion, soportaEnmascaradoCss, () => true);

  return (
    <input
      {...props}
      type={enmascaradoCss ? "text" : "password"}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      data-bwignore
      data-form-type="other"
      className={`${className ?? "input"} w-full font-mono [-webkit-text-security:disc]`}
    />
  );
}
