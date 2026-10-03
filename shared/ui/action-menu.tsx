"use client";

/**
 * Overflow menu for contextual actions ("..." on a row). Items are links,
 * buttons or separators; `tone: "danger"` marks the destructive ones and
 * they are expected LAST, after a separator. Fixed-positioned from the
 * trigger (flips up near the bottom edge), so an `overflow: auto` table
 * never clips it. Keyboard: ArrowUp/Down/Home/End, Escape returns focus.
 */
import Link from "next/link";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export type ActionMenuItem =
  | { kind: "link"; label: string; href: string; icon?: LucideIcon; tone?: "danger" }
  | { kind: "action"; label: string; onSelect: () => void; icon?: LucideIcon; tone?: "danger" }
  | { kind: "separator" };

export interface ActionMenuProps {
  /** Accessible name of the trigger, e.g. "Acciones de la receta Nº 123". */
  label: string;
  items: readonly ActionMenuItem[];
}

const GAP = 4;

export function ActionMenu({ label, items }: ActionMenuProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu;
    const fitsBelow = rect.bottom + GAP + height <= window.innerHeight - 8;
    setPosition({
      top: fitsBelow ? rect.bottom + GAP : Math.max(8, rect.top - GAP - height),
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
  }, [open]);

  // Focus only once placed: a `visibility: hidden` menu cannot take focus.
  useEffect(() => {
    if (open && position) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    }
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % entries.length;
    else if (event.key === "ArrowUp") next = (index - 1 + entries.length) % entries.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = entries.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    } else if (event.key === "Tab") {
      close(false);
      return;
    }
    if (next >= 0) {
      event.preventDefault();
      entries[next]?.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="popover menu"
          style={position ? { top: position.top, left: position.left } : { visibility: "hidden", top: 0, left: 0 }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, i) => {
            if (item.kind === "separator") return <div key={`sep-${i}`} role="separator" className="menu-separator" />;
            const Icon = item.icon;
            const className = `menu-item${item.tone === "danger" ? " menu-item-danger" : ""}`;
            const content = (
              <>
                {Icon ? <Icon aria-hidden /> : null}
                {item.label}
              </>
            );
            return item.kind === "link" ? (
              <Link key={item.label} href={item.href} role="menuitem" tabIndex={-1} className={className} onClick={() => close(false)}>
                {content}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={className}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
