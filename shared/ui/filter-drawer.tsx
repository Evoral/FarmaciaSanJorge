"use client";

/**
 * Scalable filter layout for a `FilterForm`: the few filters people use
 * every day stay inline, the rest live behind "Más filtros".
 *
 * - `FilterDrawer`: on md+ its children render inline (the wrapper is
 *   `display: contents`); on phones they move into a bottom sheet opened
 *   from a "Filtros (n)" button. ONE set of fields serves both layouts, so
 *   the form never submits a param twice.
 * - `FilterPopover`: a "Más filtros" popover on desktop; inside the phone
 *   sheet it renders as a plain section (no second layer on a small screen).
 *
 * Filters still auto-apply through `FilterForm`; the sheet's button only
 * closes it. Escape and outside clicks close both.
 */
import { ChevronDown, ListFilter, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface FilterDrawerProps {
  /** Active filters inside the drawer, shown on the phone trigger. */
  activeCount: number;
  children: ReactNode;
}

export function FilterDrawer({ activeCount, children }: FilterDrawerProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      // A nested popover (calendar, listbox) handles its own Escape first.
      if (event.key === "Escape" && !event.defaultPrevented) close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-secondary filter-drawer-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        Filtros
        {activeCount > 0 ? <span className="count-pill">{activeCount}</span> : null}
      </button>
      {open ? <div className="filter-drawer-backdrop" aria-hidden onClick={close} /> : null}
      <div
        id={panelId}
        className="filter-drawer-panel"
        data-open={open || undefined}
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={open ? "Filtros" : undefined}
      >
        <div className="filter-drawer-header">
          <h2 className="text-base font-semibold">Filtros</h2>
          <button ref={closeRef} type="button" className="btn btn-ghost btn-icon" onClick={close} aria-label="Cerrar filtros">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {children}
        <div className="filter-drawer-footer">
          <button type="button" className="btn btn-primary w-full" onClick={close}>
            Ver resultados
          </button>
        </div>
      </div>
    </>
  );
}

export interface FilterPopoverProps {
  label: string;
  /** Active filters inside, appended to the trigger. */
  activeCount?: number;
  children: ReactNode;
}

export function FilterPopover({ label, activeCount = 0, children }: FilterPopoverProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element;
      // The calendar popover is fixed-positioned outside this subtree's box but still inside it in the DOM.
      if (!rootRef.current?.contains(target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="filter-popover">
      <button
        ref={triggerRef}
        type="button"
        className="input filter-popover-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <ListFilter aria-hidden />
        <span className="text-zinc-900">{label}</span>
        {activeCount > 0 ? <span className="count-pill">{activeCount}</span> : null}
        <ChevronDown aria-hidden />
      </button>
      <div id={panelId} className="popover filter-popover-panel" data-open={open || undefined} role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
