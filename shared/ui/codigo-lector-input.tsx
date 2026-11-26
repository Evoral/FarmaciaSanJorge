"use client";

import type { ComponentProps } from "react";

/**
 * The input a keyboard-wedge reader types a secret code into (the huella): the reader "types" the code and presses
 * Enter, so the form submits by itself.
 *
 * Why not `<input type="password">`: browsers and password managers offer to save, fill or generate a value for any
 * password field, and a stored huella code would defeat the point. This is a plain text input whose characters are
 * masked with CSS (`-webkit-text-security`), plus every opt-out the common managers honour. A browser without that CSS
 * property would show the code, which is why the value is never echoed anywhere else on the page.
 *
 * No show/hide toggle (unlike `./password-input.tsx`): nobody can read a scanned code, and a toggle is one more tab stop
 * between the reader and the Enter key. Every other prop (ref included) goes to the input.
 */
export function CodigoLectorInput({ className, ...props }: Omit<ComponentProps<"input">, "type" | "autoComplete">) {
  return (
    <input
      {...props}
      type="text"
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
