/**
 * Link tabs for one screen's views (`?estado=` tabs, sub-sections). Each tab
 * is a plain link, so the server decides what is active and the URL stays
 * shareable. `count` is optional: show it only where the page already
 * knows it (never add queries just to fill a tab). Server Component.
 */
import Link from "next/link";
import { LinkPending } from "./link-pending";

export interface TabNavItem {
  key: string;
  label: string;
  href: string;
  active: boolean;
  count?: number;
}

export interface TabNavProps {
  /** Accessible name of the `<nav>`. */
  label: string;
  items: readonly TabNavItem[];
}

const numberFormat = new Intl.NumberFormat("es-AR");

export function TabNav({ label, items }: TabNavProps) {
  return (
    <nav aria-label={label} className="tab-nav">
      {items.map((item) => (
        <Link key={item.key} href={item.href} scroll={false} className="tab" aria-current={item.active ? "page" : undefined}>
          {item.label}
          {item.count !== undefined ? <span className="tab-count">{numberFormat.format(item.count)}</span> : null}
          <LinkPending />
        </Link>
      ))}
    </nav>
  );
}
