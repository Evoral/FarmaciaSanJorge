"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Drop-in replacement for `<input type="password">` (passwords and PINs) with
 * the standard show/hide toggle, so a usuario can check what they typed
 * before submitting. Every other prop (ref included) goes to the input.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${className ?? "input"} w-full pr-10`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar clave" : "Mostrar clave"}
        aria-pressed={visible}
        aria-controls={props.id}
        title={visible ? "Ocultar" : "Mostrar"}
        className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-md text-zinc-400 hover:text-zinc-700 focus-visible:text-zinc-700 dark:hover:text-zinc-200"
      >
        {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}
