"use client";

/**
 * Date field with the app's own calendar popover, replacing the browser's
 * native `<input type="date">` picker (whose popup cannot be styled).
 *
 * - Same form contract as the native field: a hidden input named `name`
 *   submits ISO `YYYY-MM-DD` (or ""), so server actions and GET filter
 *   forms keep working unchanged.
 * - Typing stays first-class: `dd/mm/aaaa` with auto-inserted slashes and a
 *   numeric keypad on mobile. The calendar button is NOT a tab stop (keeps
 *   keyboard data entry fast); ArrowDown / Alt+ArrowDown opens it.
 * - Cheap by design: the calendar only renders while open, document/window
 *   listeners only exist while open, and there is no date library (Date.UTC
 *   math on ISO strings).
 * - Native constraint validation (`required`, `min`, `max`, bad format)
 *   runs on the visible field through setCustomValidity.
 * - Server-side field errors (`shared/ui/field-errors.ts`) arrive as a
 *   `FIELD_ERROR_EVENT` on the hidden input: the visible field shows them
 *   through the SAME React-owned `aria-invalid` as its own errors (so the
 *   two never fight) and clears the mark as soon as the date is edited.
 * - Committing a complete valid date (typed or picked) or clearing the
 *   field dispatches a bubbling `change` on the hidden input, after React
 *   has written the new value; a half-typed date never does. That is what
 *   `./filter-form.tsx` auto-applies on. Server Action forms ignore it
 *   (nothing listens for `change` on a hidden input there).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { jornadaDe } from "@/shared/time/jornada";
import { FIELD_ERROR_EVENT, type FieldErrorEventDetail } from "./field-errors";

export interface DateInputProps {
  id?: string;
  /** Form field name; carried by a hidden input holding the ISO value. */
  name?: string;
  /** Uncontrolled initial ISO value (`YYYY-MM-DD` or ""). */
  defaultValue?: string;
  /** Controlled ISO value (`YYYY-MM-DD` or ""). */
  value?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Inclusive ISO lower bound. */
  min?: string;
  /** Inclusive ISO upper bound. */
  max?: string;
}

type View = "days" | "months" | "years";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;
const POPOVER_WIDTH = 272;
const POPOVER_MAX_HEIGHT = 340;
const GAP = 6;
const KEY_DAY_DELTAS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

export function DateInput({ id, name, defaultValue = "", value, onValueChange, required, disabled, min, max }: DateInputProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const calendarId = `${fieldId}-calendar`;

  const controlled = value !== undefined;
  const [innerValue, setInnerValue] = useState(defaultValue);
  // Re-sync when the server hands a new defaultValue on a soft navigation.
  const [seenDefault, setSeenDefault] = useState(defaultValue);
  if (!controlled && defaultValue !== seenDefault) {
    setSeenDefault(defaultValue);
    setInnerValue(defaultValue);
  }
  const iso = controlled ? value : innerValue;

  // Text the user is typing that is not (yet) a complete valid date.
  const [draft, setDraft] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  // Marked invalid by a server action error (see the module doc comment).
  const [serverInvalid, setServerInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("days");
  const [cursor, setCursor] = useState("");
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });

  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const focusDayRef = useRef(false);
  const commitRef = useRef(false);

  const error =
    draft !== null
      ? "Ingresá una fecha válida (dd/mm/aaaa)."
      : iso && min && iso < min
        ? `La fecha no puede ser anterior al ${formatDisplay(min)}.`
        : iso && max && iso > max
          ? `La fecha no puede ser posterior al ${formatDisplay(max)}.`
          : "";

  useEffect(() => {
    fieldRef.current?.setCustomValidity(error);
  }, [error]);

  // React 19 resets uncontrolled forms after a successful action (and
  // `form.reset()` may be called directly): mirror the native field's reset.
  useEffect(() => {
    const form = fieldRef.current?.form;
    if (!form || controlled) return;
    function onReset() {
      setInnerValue(defaultValue);
      setDraft(null);
      setShowError(false);
      setServerInvalid(false);
    }
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [controlled, defaultValue]);

  useEffect(() => {
    const hidden = hiddenRef.current;
    if (!hidden) return;
    function onFieldError(event: Event) {
      const detail = (event as CustomEvent<FieldErrorEventDetail>).detail;
      event.preventDefault();
      detail.focusTarget = fieldRef.current;
      setServerInvalid(detail.invalid);
    }
    hidden.addEventListener(FIELD_ERROR_EVENT, onFieldError);
    return () => hidden.removeEventListener(FIELD_ERROR_EVENT, onFieldError);
  }, [name]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || calendarRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onViewportChange() {
      setPosition(computePosition(rootRef.current));
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !focusDayRef.current) return;
    focusDayRef.current = false;
    calendarRef.current?.querySelector<HTMLButtonElement>("[data-focus]")?.focus();
  }, [open, cursor, view]);

  // A committed edit (see the module doc comment) is announced to the form once React has written it to the hidden input.
  useEffect(() => {
    if (!commitRef.current) return;
    commitRef.current = false;
    hiddenRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [iso]);

  /** `commit` = a complete valid date or an explicit clear, never a half-typed date. */
  function setIso(next: string, commit = true) {
    setServerInvalid(false);
    if (next === iso) return;
    commitRef.current = commit;
    if (!controlled) setInnerValue(next);
    onValueChange?.(next);
  }

  function openCalendar() {
    if (disabled) return;
    const today = jornadaDe(new Date());
    setPosition(computePosition(rootRef.current));
    setCursor(clampIso(isValidIso(iso) ? iso : today, min, max));
    setView("days");
    focusDayRef.current = true;
    setOpen(true);
  }

  function closeCalendar(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) fieldRef.current?.focus();
  }

  function select(next: string) {
    setIso(next);
    setDraft(null);
    setShowError(false);
    closeCalendar(true);
  }

  function moveCursor(next: string, focus = true) {
    setCursor(clampIso(next, min, max));
    if (focus) focusDayRef.current = true;
  }

  function changeView(next: View) {
    focusDayRef.current = true;
    setView(next);
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openCalendar();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeCalendar(false);
    }
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: string | null = null;
    if (event.key in KEY_DAY_DELTAS) next = addDays(cursor, KEY_DAY_DELTAS[event.key]!);
    else if (event.key === "PageUp") next = addMonths(cursor, event.shiftKey ? -12 : -1);
    else if (event.key === "PageDown") next = addMonths(cursor, event.shiftKey ? 12 : 1);
    else if (event.key === "Home") next = addDays(cursor, -weekdayIndex(cursor));
    else if (event.key === "End") next = addDays(cursor, 6 - weekdayIndex(cursor));
    if (next === null) return;
    event.preventDefault();
    moveCursor(next);
  }

  const text = draft ?? formatDisplay(iso);

  return (
    <div ref={rootRef} className="date-input">
      <input
        ref={fieldRef}
        id={fieldId}
        type="text"
        role="combobox"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={text}
        required={required}
        disabled={disabled}
        aria-invalid={(showError && error) || serverInvalid ? true : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? calendarId : undefined}
        aria-keyshortcuts="Alt+ArrowDown"
        className="input"
        onChange={(event) => {
          const masked = maskTyping(event.target.value);
          const parsed = parseDisplay(masked);
          setShowError(false);
          setDraft(parsed || masked === "" ? null : masked);
          setIso(parsed ?? "", parsed !== null || masked === "");
        }}
        onBlur={() => setShowError(true)}
        onKeyDown={onFieldKeyDown}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Abrir calendario"
        aria-expanded={open}
        className="date-input-trigger"
        onClick={() => (open ? closeCalendar(true) : openCalendar())}
      >
        <CalendarDays className="size-4" aria-hidden />
      </button>
      {name ? <input ref={hiddenRef} type="hidden" name={name} value={iso} data-date-input="" /> : null}

      {open
        ? createPortal(
            <div
              ref={calendarRef}
              id={calendarId}
              role="dialog"
              aria-label="Elegir fecha"
              className="calendar"
              style={{ left: position.left, top: position.top, bottom: position.bottom }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeCalendar(true);
                }
              }}
              onBlur={(event) => {
                const next = event.relatedTarget as Node | null;
                if (next && (calendarRef.current?.contains(next) || rootRef.current?.contains(next))) return;
                if (next) setOpen(false);
              }}
            >
              <CalendarBody view={view} setView={changeView} cursor={cursor} selected={iso} min={min} max={max} onMove={moveCursor} onSelect={select} onGridKeyDown={onGridKeyDown} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function CalendarBody({
  view,
  setView,
  cursor,
  selected,
  min,
  max,
  onMove,
  onSelect,
  onGridKeyDown,
}: {
  view: View;
  setView: (view: View) => void;
  cursor: string;
  selected: string;
  min?: string;
  max?: string;
  /** `focus` = move keyboard focus to the new cursor cell (false for the header arrows). */
  onMove: (iso: string, focus?: boolean) => void;
  onSelect: (iso: string) => void;
  onGridKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const [year, month, day] = parts(cursor);
  const today = jornadaDe(new Date());
  const todayInRange = isInRange(today, min, max);
  const decadeStart = Math.floor(year / 12) * 12;

  const header =
    view === "days"
      ? { label: `${MONTHS[month - 1]} ${year}`, step: 1, next: "months" as View }
      : view === "months"
        ? { label: String(year), step: 12, next: "years" as View }
        : { label: `${decadeStart} – ${decadeStart + 11}`, step: 144, next: null };

  return (
    <>
      <div className="calendar-header">
        <button type="button" className="glass-icon-btn" aria-label="Anterior" onClick={() => onMove(addMonths(cursor, -header.step), false)}>
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        {header.next ? (
          <button type="button" className="calendar-title" onClick={() => setView(header.next!)}>
            {header.label}
          </button>
        ) : (
          <span className="calendar-title">{header.label}</span>
        )}
        <button type="button" className="glass-icon-btn" aria-label="Siguiente" onClick={() => onMove(addMonths(cursor, header.step), false)}>
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      {view === "days" ? (
        <div role="grid" aria-label={`${MONTHS[month - 1]} ${year}`} onKeyDown={onGridKeyDown}>
          <div role="row" className="calendar-week">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday} role="columnheader" className="calendar-weekday">
                {weekday}
              </span>
            ))}
          </div>
          {monthWeeks(year, month).map((week, index) => (
            <div key={index} role="row" className="calendar-week">
              {week.map((cell, cellIndex) =>
                cell ? (
                  <span key={cell} role="gridcell">
                    <button
                      type="button"
                      data-focus={cell === cursor || undefined}
                      tabIndex={cell === cursor ? 0 : -1}
                      disabled={!isInRange(cell, min, max)}
                      aria-label={longLabel(cell)}
                      aria-pressed={cell === selected}
                      aria-current={cell === today ? "date" : undefined}
                      className="calendar-day"
                      onClick={() => onSelect(cell)}
                    >
                      {Number(cell.slice(8))}
                    </button>
                  </span>
                ) : (
                  <span key={`empty-${cellIndex}`} role="gridcell" />
                ),
              )}
            </div>
          ))}
        </div>
      ) : view === "months" ? (
        <div className="calendar-cells">
          {MONTHS_SHORT.map((label, index) => {
            const first = toIso(year, index + 1, 1);
            const last = toIso(year, index + 1, daysInMonth(year, index + 1));
            return (
              <button
                key={label}
                type="button"
                className="calendar-day"
                data-focus={index + 1 === month || undefined}
                aria-pressed={selected.slice(0, 7) === first.slice(0, 7)}
                disabled={(min !== undefined && last < min) || (max !== undefined && first > max)}
                onClick={() => {
                  onMove(toIso(year, index + 1, Math.min(day, daysInMonth(year, index + 1))));
                  setView("days");
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="calendar-cells">
          {Array.from({ length: 12 }, (_, index) => decadeStart + index).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className="calendar-day"
              data-focus={candidate === year || undefined}
              aria-pressed={selected.slice(0, 4) === String(candidate)}
              disabled={candidate < MIN_YEAR || candidate > MAX_YEAR || (min !== undefined && `${candidate}-12-31` < min) || (max !== undefined && `${candidate}-01-01` > max)}
              onClick={() => {
                onMove(toIso(candidate, month, Math.min(day, daysInMonth(candidate, month))));
                setView("months");
              }}
            >
              {candidate}
            </button>
          ))}
        </div>
      )}

      <div className="calendar-footer">
        <button type="button" className="calendar-link" onClick={() => onSelect("")}>
          Borrar
        </button>
        <button type="button" className="calendar-link" disabled={!todayInRange} onClick={() => onSelect(today)}>
          Hoy
        </button>
      </div>
    </>
  );
}

function computePosition(anchor: HTMLElement | null): { left: number; top?: number; bottom?: number } {
  if (!anchor) return { left: 0 };
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
  const fitsBelow = rect.bottom + GAP + POPOVER_MAX_HEIGHT <= window.innerHeight;
  const fitsAbove = rect.top - GAP - POPOVER_MAX_HEIGHT >= 0;
  return !fitsBelow && fitsAbove ? { left, bottom: window.innerHeight - rect.top + GAP } : { left, top: rect.bottom + GAP };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parts(iso: string): [number, number, number] {
  const [year, month, day] = iso.split("-").map(Number);
  return [year!, month!, day!];
}

function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [year, month, day] = parts(iso);
  return year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function addDays(iso: string, delta: number): string {
  const [year, month, day] = parts(iso);
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
}

function addMonths(iso: string, delta: number): string {
  const [year, month, day] = parts(iso);
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.floor(index / 12)));
  const nextMonth = (index % 12) + 1;
  return toIso(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}

/** Monday-based weekday index (0 = lunes). */
function weekdayIndex(iso: string): number {
  const [year, month, day] = parts(iso);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function isInRange(iso: string, min?: string, max?: string): boolean {
  return (min === undefined || iso >= min) && (max === undefined || iso <= max);
}

function clampIso(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

function monthWeeks(year: number, month: number): (string | null)[][] {
  const cells: (string | null)[] = Array.from({ length: weekdayIndex(toIso(year, month, 1)) }, () => null);
  for (let day = 1; day <= daysInMonth(year, month); day++) cells.push(toIso(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

function formatDisplay(iso: string): string {
  if (!isValidIso(iso)) return "";
  const [year, month, day] = parts(iso);
  return `${pad(day)}/${pad(month)}/${year}`;
}

function longLabel(iso: string): string {
  const [year, month, day] = parts(iso);
  return `${day} de ${MONTHS[month - 1]!.toLowerCase()} de ${year}`;
}

/** Digits only, slashes auto-inserted: "25092026" -> "25/09/2026". */
function maskTyping(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseDisplay(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidIso(iso) ? iso : null;
}
