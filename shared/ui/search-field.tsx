"use client";

/**
 * Search input with a leading icon and a clear button (also Escape). Works
 * inside `FilterForm`: clearing dispatches a native `input` event, which
 * the form already debounces and applies. Uncontrolled, so the form's own
 * `reset()` after an outside navigation still restores the URL's value.
 */
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface SearchFieldProps {
  id: string;
  name: string;
  label: string;
  /** Visually hide the label (it stays for screen readers). */
  hideLabel?: boolean;
  defaultValue?: string;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "search";
  className?: string;
}

export function SearchField({ id, name, label, hideLabel, defaultValue = "", placeholder, inputMode, className }: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasValue, setHasValue] = useState(defaultValue !== "");

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => setTimeout(() => setHasValue((inputRef.current?.value ?? "") !== ""), 0);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  function clear() {
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    setHasValue(false);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && event.currentTarget.value !== "") {
      event.preventDefault();
      clear();
    }
  }

  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "field-label"}>
        {label}
      </label>
      <div className="search-field">
        <Search aria-hidden />
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="search"
          inputMode={inputMode}
          autoComplete="off"
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="input"
          onInput={(event) => setHasValue(event.currentTarget.value !== "")}
          onKeyDown={onKeyDown}
        />
        {hasValue ? (
          <button type="button" className="field-clear" onClick={clear} aria-label={`Borrar ${label.toLowerCase()}`}>
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
