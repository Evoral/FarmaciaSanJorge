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
 * - `enterRunsAction`: a search box. No option starts highlighted and
 *   Enter never picks: it runs `actionOption` with the highlighted
 *   option's label, or else the typed text. Only a click picks.
 * - With `name`, a hidden input carries the value and a bubbling `change`
 *   is dispatched on pick/clear, so it drops into a `FilterForm` like
 *   `./date-input.tsx` does. It also handles `FIELD_ERROR_EVENT`
 *   (`./field-errors.ts`): a Server Action error that names the field marks
 *   the visible input as invalid and focuses it; picking or clearing a value
 *   removes the mark.
 * - An option found through one of its `sinonimos` is picked WITH that
 *   `sinonimo` (the whole option reaches `onChange`): while it is the
 *   value, the field shows the synonym the user chose, followed by the
 *   canonical `label` as a quiet hint ("Acetaminofén ≈ Paracetamol",
 *   openspec/specs/sinonimos-droga/spec.md "Nombre elegido al cargar"). Parents that
 *   keep the picked option as their `value` get this for free.
 *
 * - `floating`: the list is laid out `position: fixed` over the field, so a
 *   scrolling container (a `<dialog>` with a max height) never clips it.
 *
 * Sources that touch personal data (pacientes, DP-24) must search through
 * a Server Action (POST), never through the URL.
 */
import { AlertCircle, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { FIELD_ERROR_EVENT, type FieldErrorEventDetail } from "./field-errors";
import { SinonimoHint } from "./sinonimo-hint";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Short trailing detail (code, matrícula, unidad...). */
  description?: string;
  /** Other names the option is also found by (a droga's synonyms, openspec/specs/sinonimos-droga/spec.md): searched by `filtrarOpciones`, never shown as such. */
  sinonimos?: readonly string[];
  /**
   * The synonym the query matched through, when the label itself did not match: in the list, a quiet hint after the
   * label (`./sinonimo-hint.tsx`); on the selected `value`, the field's main text, with the label as the hint.
   */
  sinonimo?: string | null;
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
  /**
   * Search-box behavior: no option starts highlighted, and Enter never picks -- it runs `actionOption` with the
   * highlighted option's label (arrows or mouse), else the typed text. Only a click picks. Without it, Enter picks the
   * first suggestion.
   */
  enterRunsAction?: boolean;
  /** Lay the list out `position: fixed` over the field: it escapes a scrolling container (a dialog) instead of being clipped. */
  floating?: boolean;
}

const DEBOUNCE_MS = 200;

/** What the field shows for a selected option: the synonym it was picked by, else its label. */
function textoDe(option: ComboboxOption | null): string {
  return option ? option.sinonimo || option.label : "";
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * A local `search` source for options the page already received from the
 * server (no extra request): accent- and case-insensitive "contains" match
 * on label and description, then on the option's `sinonimos` (an option
 * found only through one carries it as `sinonimo`, for the hint), capped at
 * `limit` results.
 */
export function filtrarOpciones(options: readonly ComboboxOption[], limit = 30) {
  return async (query: string): Promise<readonly ComboboxOption[]> => {
    const q = fold(query.replace(/\s+/g, " ").trim());
    if (!q) return options.slice(0, limit);
    const matches: ComboboxOption[] = [];
    for (const option of options) {
      if (matches.length >= limit) break;
      if (fold(`${option.label} ${option.description ?? ""}`).includes(q)) {
        matches.push(option);
        continue;
      }
      const sinonimo = option.sinonimos?.find((s) => fold(s).includes(q));
      if (sinonimo) matches.push({ ...option, sinonimo });
    }
    return matches;
  };
}

type Status = "idle" | "loading" | "error" | "ready";

/** `floating`: the list's fixed box under the field, kept in place while anything scrolls or the window resizes. */
function usePosicionFlotante(controlRef: RefObject<HTMLDivElement | null>, activa: boolean): CSSProperties | null {
  const [posicion, setPosicion] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!activa) return;
    function ubicar() {
      const rect = controlRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const width = Math.min(rect.width, vw - 16);
      const left = Math.max(8, Math.min(rect.left, vw - width - 8));
      const maxHeight = Math.max(120, vh - rect.bottom - 14);
      setPosicion({ position: "fixed", top: rect.bottom + 6, left, width, right: "auto", maxHeight, overflowY: "auto" });
    }
    ubicar();
    window.addEventListener("scroll", ubicar, true);
    window.addEventListener("resize", ubicar);
    return () => {
      window.removeEventListener("scroll", ubicar, true);
      window.removeEventListener("resize", ubicar);
    };
  }, [controlRef, activa]);
  // A stale box from the previous opening is never used: the effect re-measures before paint.
  return activa ? posicion : null;
}

export function Combobox({ id, label, visibleLabel, hideLabel, placeholder, search, value, onChange, name, helperText, disabled, size = "md", actionOption, enterRunsAction = false, floating = false }: ComboboxProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const helpId = `${autoId}-help`;
  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [text, setText] = useState(textoDe(value));
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [options, setOptions] = useState<readonly ComboboxOption[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [lastQuery, setLastQuery] = useState("");
  const [serverInvalid, setServerInvalid] = useState(false);

  // A Server Action error naming this field (`name`) marks the visible input; see `./field-errors.ts`.
  useEffect(() => {
    const hidden = hiddenRef.current;
    if (!hidden) return;
    function onFieldError(event: Event) {
      const detail = (event as CustomEvent<FieldErrorEventDetail>).detail;
      event.preventDefault();
      detail.focusTarget = inputRef.current;
      setServerInvalid(detail.invalid);
    }
    hidden.addEventListener(FIELD_ERROR_EVENT, onFieldError);
    return () => hidden.removeEventListener(FIELD_ERROR_EVENT, onFieldError);
  }, [name]);

  // Follow an outside value change (pick, clear, form reset). Compared by content, not identity:
  // parents usually rebuild the `value` object on every render.
  const valueKey = value ? `${value.value}\u0000${value.label}\u0000${value.sinonimo ?? ""}` : "";
  const [seenKey, setSeenKey] = useState(valueKey);
  if (valueKey !== seenKey) {
    setSeenKey(valueKey);
    setText(textoDe(value));
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
        setActiveIndex(result.length > 0 && !enterRunsAction ? 0 : -1);
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
    setServerInvalid(false);
    onChange(option);
    setText(textoDe(option));
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
    setServerInvalid(false);
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
        if (enterRunsAction && actionOption) {
          // Enter always searches, never picks: a highlighted option (among the current results, not a previous
          // query's) is searched by its name; otherwise the typed text is.
          event.preventDefault();
          const resaltada = open && status === "ready" && lastQuery === text.trim() ? options[activeIndex] : undefined;
          const query = resaltada ? resaltada.label : text.trim();
          clearTimeout(debounceRef.current);
          requestRef.current?.abort();
          setOpen(false);
          setText(query);
          actionOption.onSelect(query);
          return;
        }
        // Never submit the surrounding form from inside the autocomplete.
        if (open) event.preventDefault();
        if (open && activeIndex >= 0) choose(activeIndex);
        return;
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
          setText(textoDe(value));
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
  // Picked through a synonym and still showing it: the canonical name follows the text as a quiet hint.
  const nombrePrincipal = value?.sinonimo && text === value.sinonimo ? value.label : null;
  const nombrePrincipalId = `${autoId}-principal`;
  const describedBy = [helperText ? helpId : null, nombrePrincipal ? nombrePrincipalId : null].filter(Boolean).join(" ") || undefined;
  const activeId = open && activeIndex >= 0 ? `${autoId}-opt-${activeIndex}` : undefined;
  const posicion = usePosicionFlotante(controlRef, floating && showList);

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
        <div ref={controlRef} className="combobox-control">
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
            aria-describedby={describedBy}
            aria-invalid={serverInvalid || undefined}
            title={nombrePrincipal ? `Nombre principal: ${nombrePrincipal}` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              // A highlight chosen for the previous text no longer applies.
              if (enterRunsAction) setActiveIndex(-1);
              openWith(event.target.value);
            }}
            onFocus={() => openWith(text === textoDe(value) ? "" : text)}
            onBlur={() => {
              setOpen(false);
              setText(textoDe(value));
            }}
            onKeyDown={onKeyDown}
          />
          {nombrePrincipal ? (
            // Mirrors the input's text box (same left padding + border, same font size) so the hint lands right after
            // the text; purely visual -- screen readers get it through the input's aria-describedby.
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-[calc(2rem+1px)] right-8 flex items-center overflow-hidden whitespace-nowrap text-sm">
              <span className="invisible">{text}</span>
              <span className="ml-1.5 truncate text-xs text-zinc-400">≈ {nombrePrincipal}</span>
            </span>
          ) : null}
          {nombrePrincipal ? (
            <span id={nombrePrincipalId} className="sr-only">
              Nombre principal: {nombrePrincipal}
            </span>
          ) : null}
          {text !== "" && !disabled ? (
            <button type="button" className="field-clear" onMouseDown={(event) => event.preventDefault()} onClick={clear} aria-label={`Borrar ${label.toLowerCase()}`}>
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        {showList ? (
          <div className="popover" style={posicion ?? undefined}>
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
                    <SinonimoHint sinonimo={option.sinonimo} />
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
