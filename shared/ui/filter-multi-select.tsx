"use client";

/**
 * "Filtros (n)" dropdown that groups a list page's BOOLEAN filters (one
 * checkbox each) inside a `FilterForm` (`./filter-form.tsx`). Global
 * convention: yes/no filters live here; filters with 2+ values (estado,
 * magnitud, orden...) keep their own `<select>`.
 *
 * - Every option is a real `<input type="checkbox" name=... value="1">`
 *   inside the form, so `FilterForm` applies it on change and the form
 *   still works without JS (native `<details>`/`<summary>` opens the list;
 *   Enter submits).
 * - Closes on outside click, Escape (focus returns to the button) and when
 *   focus leaves the list. Opaque surface, same as the calendar popover
 *   (a see-through popover over a table is hard to read).
 * - The count in the button follows the checkboxes immediately, and
 *   re-syncs with the server's values after every navigation.
 */
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";

const CHECKED = 'input[type="checkbox"]:checked';

export interface FilterMultiSelectOption {
  /** Query param name; the checkbox submits `name=1` when checked. */
  name: string;
  label: string;
  checked: boolean;
}

export interface FilterMultiSelectProps {
  options: readonly FilterMultiSelectOption[];
  /** Button text; the active count is appended ("Filtros (2)"). */
  label?: string;
}

export function FilterMultiSelect({ options, label = "Filtros" }: FilterMultiSelectProps) {
  const listId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  const serverCount = options.filter((option) => option.checked).length;
  const serverSignature = options.map((option) => (option.checked ? "1" : "0")).join("");
  const [count, setCount] = useState(serverCount);
  const [seenSignature, setSeenSignature] = useState(serverSignature);
  if (serverSignature !== seenSignature) {
    setSeenSignature(serverSignature);
    setCount(serverCount);
  }

  function recount() {
    setCount(detailsRef.current?.querySelectorAll(CHECKED).length ?? 0);
  }

  function close(returnFocus: boolean) {
    if (detailsRef.current) detailsRef.current.open = false;
    if (returnFocus) summaryRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (details && !details.contains(event.target as Node)) details.open = false;
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // `form.reset()` (FilterForm re-syncing after an outside navigation) flips the checkboxes without a change event.
  useEffect(() => {
    const details = detailsRef.current;
    const form = details?.closest("form");
    if (!details || !form) return;
    function onReset() {
      setTimeout(() => setCount(details!.querySelectorAll(CHECKED).length), 0);
    }
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key === "Escape" && detailsRef.current?.open) {
      event.preventDefault();
      close(true);
    }
  }

  function onBlur(event: FocusEvent<HTMLDetailsElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && !detailsRef.current?.contains(next)) close(false);
  }

  return (
    <details ref={detailsRef} className="filter-select" onToggle={(event) => setOpen(event.currentTarget.open)} onKeyDown={onKeyDown} onBlur={onBlur}>
      <summary ref={summaryRef} className="input filter-select-button" aria-controls={listId}>
        <span>
          {label}
          {count > 0 ? ` (${count})` : ""}
        </span>
        <ChevronDown className="size-4" aria-hidden />
      </summary>
      <fieldset id={listId} className="filter-select-menu" onChange={recount}>
        <legend className="sr-only">{label}</legend>
        {options.map((option) => (
          <label key={option.name} className="filter-select-option">
            <input type="checkbox" name={option.name} value="1" defaultChecked={option.checked} />
            {option.label}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
