"use client";

/**
 * Autocomplete (ARIA 1.2 combobox + listbox) over an async source. THE
 * pattern for picking or filtering by paciente, médico, cliente,
 * proveedor, droga... : results appear and narrow while typing.
 *
 * - Opens on focus with the source's default suggestions, filters while
 *   typing (debounced); a stale answer never overwrites a newer one.
 * - Keyboard: ArrowUp/Down move, Enter picks, Escape closes (or clears
 *   the text when already closed), Tab leaves. The active option stays
 *   scrolled into view and is announced via aria-activedescendant.
 * - Visible states: loading, error (with retry), no matches, selected.
 * - `actionOption`: a last action row for the typed text (also reachable
 *   by keyboard): "Crear paciente “x”", "Buscar “x” en la lista"...
 * - With `name`, a hidden input carries the value and a bubbling `change`
 *   is dispatched on pick/clear, so it drops into a `FilterForm` like
 *   `./date-input.tsx` does.
 *
 * Sources that touch personal data (pacientes, DP-24) must search through
 * a Server Action (POST), never through the URL.
 */
import { AlertCircle, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Short trailing detail (code, matrícula, unidad...). */
  description?: string;
}

export interface ComboboxActionOption {
  /** Row text for the current query, e.g. (q) => `Crear paciente “${q}”`. */
  label: (query: string) => string;
  onSelect: (query: string) => void;
  /** Defaults to a plus sign (create). */
  icon?: ReactNode;
}

export interface ComboboxProps {
  id?: string;
  /** Accessible name (and the visible label unless `visibleLabel` is given). */
  label: string;
  /** Shorter visible label; `label` is still what screen readers hear. */
  visibleLabel?: ReactNode;
  /** Keep the label for screen readers only (filter bars). */
  hideLabel?: boolean;
  placeholder?: string;
  /** Resolves the options for a trimmed query ("" = default suggestions). */
  search: (query: string, signal: AbortSignal) => Promise<readonly ComboboxOption[]>;
  value: ComboboxOption | null;
  onChange: (option: ComboboxOption | null) => void;
  /** Form field name; when set, a hidden input submits the value. */
  name?: string;
  helperText?: ReactNode;
  disabled?: boolean;
  size?: "md" | "sm";
  actionOption?: ComboboxActionOption;
}

const DEBOUNCE_MS = 200;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * A local `search` source for options the page already received from the
 * server (no extra request): accent- and case-insensitive "contains" match
 * on label and description, capped at `limit` results.
 */
export function filtrarOpciones(options: readonly ComboboxOption[], limit = 30) {
  return async (query: string): Promise<readonly ComboboxOption[]> => {
    const q = fold(query.trim());
    const matches = q ? options.filter((option) => fold(`${option.label} ${option.description ?? ""}`).includes(q)) : options;
    return matches.slice(0, limit);
  };
}

type Status = "idle" | "loading" | "error" | "ready";

export function Combobox({ id, label, visibleLabel, hideLabel, placeholder, search, value, onChange, name, helperText, disabled, size = "md", actionOption }: ComboboxProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const helpId = `${autoId}-help`;
  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [text, setText] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [options, setOptions] = useState<readonly ComboboxOption[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [lastQuery, setLastQuery] = useState("");

  // Follow an outside value change (pick, clear, form reset). Compared by content, not identity:
  // parents usually rebuild the `value` object on every render.
  const valueKey = value ? `${value.value}\u0000${value.label}` : "";
  const [seenKey, setSeenKey] = useState(valueKey);
  if (valueKey !== seenKey) {
    setSeenKey(valueKey);
    setText(value?.label ?? "");
  }

  const firstValueKey = useRef(valueKey);
  useEffect(() => {
    if (valueKey === firstValueKey.current) return;
    firstValueKey.current = "\u0001"; // after the first change, every change notifies
    hiddenRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [valueKey]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      clearTimeout(debounceRef.current);
    },
    [],
  );

  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const showCreate = Boolean(actionOption) && status === "ready";
  const navigable = options.length + (showCreate ? 1 : 0);

  function run(query: string) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    setLastQuery(query);
    search(query, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setOptions(result);
        setActiveIndex(result.length > 0 ? 0 : -1);
        setStatus("ready");
      },
      () => {
        if (controller.signal.aborted) return;
        setOptions([]);
        setActiveIndex(-1);
        setStatus("error");
      },
    );
  }

  function openWith(query: string) {
    setOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => run(query.trim()), DEBOUNCE_MS);
  }

  function pick(option: ComboboxOption) {
    onChange(option);
    setText(option.label);
    setOpen(false);
  }

  function create() {
    if (!actionOption) return;
    setOpen(false);
    actionOption.onSelect(lastQuery);
  }

  function choose(index: number) {
    if (index < options.length) {
      const option = options[index];
      if (option) pick(option);
    } else if (showCreate) {
      create();
    }
  }

  function clear() {
    onChange(null);
    setText("");
    inputRef.current?.focus();
    openWith("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          openWith(text);
          return;
        }
        if (navigable === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) => (index + step + navigable) % navigable);
        return;
      }
      case "Enter":
        // Never submit the surrounding form from inside the autocomplete.
        if (open) event.preventDefault();
        if (open && activeIndex >= 0) choose(activeIndex);
        return;
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
          setText(value?.label ?? "");
        } else if (text !== "") {
          event.preventDefault();
          clear();
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  }

  const showList = open && status !== "idle";
  const activeId = open && activeIndex >= 0 ? `${autoId}-opt-${activeIndex}` : undefined;

  return (
    <div className="field min-w-0">
      <label htmlFor={inputId} className={hideLabel ? "sr-only" : "field-label"}>
        {visibleLabel ? (
          <>
            <span aria-hidden>{visibleLabel}</span>
            <span className="sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </label>
      <div className="combobox">
        <div className="combobox-control">
          <Search aria-hidden />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            className={size === "sm" ? "input input-sm" : "input"}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            disabled={disabled}
            value={text}
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-describedby={helperText ? helpId : undefined}
            onChange={(event) => {
              setText(event.target.value);
              openWith(event.target.value);
            }}
            onFocus={() => openWith(text === value?.label ? "" : text)}
            onBlur={() => {
              setOpen(false);
              setText(value?.label ?? "");
            }}
            onKeyDown={onKeyDown}
          />
          {text !== "" && !disabled ? (
            <button type="button" className="field-clear" onMouseDown={(event) => event.preventDefault()} onClick={clear} aria-label={`Borrar ${label.toLowerCase()}`}>
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        {showList ? (
          <div className="popover">
            {status === "loading" && options.length === 0 ? (
              <p className="popover-status">
                <span className="spinner" aria-hidden />
                Buscando…
              </p>
            ) : null}
            {status === "error" ? (
              <p className="popover-status text-red-700">
                <AlertCircle className="size-4" aria-hidden />
                No se pudo completar la búsqueda.
                <button type="button" className="ml-auto font-medium text-primary underline" onMouseDown={(event) => event.preventDefault()} onClick={() => run(lastQuery)}>
                  Reintentar
                </button>
              </p>
            ) : null}
            {status === "ready" && options.length === 0 ? (
              <p className="popover-status">{lastQuery ? `Sin coincidencias para “${lastQuery}”.` : "No hay opciones disponibles."}</p>
            ) : null}
            <ul ref={listRef} id={listId} role="listbox" aria-label={label} aria-busy={status === "loading"} className="listbox" hidden={navigable === 0}>
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${autoId}-opt-${index}`}
                  role="option"
                  data-index={index}
                  aria-selected={value?.value === option.value}
                  data-active={index === activeIndex || undefined}
                  className="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => pick(option)}
                >
                  <span className="truncate">
                    <Highlight text={option.label} query={lastQuery} />
                  </span>
                  {option.description ? <span className="option-description">{option.description}</span> : null}
                </li>
              ))}
              {showCreate && actionOption ? (
                <li
                  id={`${autoId}-opt-${options.length}`}
                  role="option"
                  data-index={options.length}
                  aria-selected={false}
                  data-active={activeIndex === options.length || undefined}
                  className="option option-create"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActiveIndex(options.length)}
                  onClick={create}
                >
                  {actionOption.icon ?? <Plus className="size-4 flex-none" aria-hidden />}
                  <span className="truncate">{actionOption.label(lastQuery)}</span>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {open && status === "ready" ? `${options.length} ${options.length === 1 ? "resultado" : "resultados"}` : ""}
        </p>
      </div>
      {helperText ? (
        <p id={helpId} className="field-help">
          {helperText}
        </p>
      ) : null}
      {name ? <input ref={hiddenRef} type="hidden" name={name} value={value?.value ?? ""} /> : null}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const start = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (start < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + query.length)}</mark>
      {text.slice(start + query.length)}
    </>
  );
}
