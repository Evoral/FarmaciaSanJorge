/**
 * Per-estado (or per-signal) overview for a list page: an optional
 * headline metric (the work still in progress) with a meter of how it
 * splits, plus one tab per estado with its count. The tabs ARE the filter
 * (links that set/clear the param), so the numbers the user reads are the
 * shortcut they click. Secondary tabs (terminal estados) render quieter:
 * they are history, not work. Server Component.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { BadgeTone } from "./status-badge";
import { LinkPending } from "./link-pending";

type Unit = readonly [singular: string, plural: string];

export interface StatusSummaryItem {
  key: string;
  label: string;
  count: number;
  href: string;
  active: boolean;
  tone: BadgeTone;
  /** Terminal estado: shown after the work estados, de-emphasized and left out of the meter. */
  secondary?: boolean;
  /** Overrides the summary's `unit` for this tab (e.g. drogas vs partidas). */
  unit?: Unit;
}

export interface StatusSummaryProps {
  /** Accessible name of the tab list, e.g. "Filtrar por estado". */
  label: string;
  /** Omit for a plain strip of tabs (no lead column). */
  headline?: { value: number; label: string; caption?: ReactNode };
  /** The "everything" tab; `count` is optional when the page does not know the unfiltered total. */
  all: { label: string; count?: number; href: string; active: boolean };
  items: readonly StatusSummaryItem[];
  /** One quiet line under the headline (or under the tabs, without headline). */
  note?: ReactNode;
  /** Unit for screen readers, e.g. ["receta", "recetas"]. */
  unit: Unit;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export function StatusSummary({ label, headline, all, items, note, unit }: StatusSummaryProps) {
  const work = items.filter((item) => !item.secondary);
  const history = items.filter((item) => item.secondary);
  const workTotal = work.reduce((sum, item) => sum + item.count, 0);
  const describe = (count: number, u: Unit = unit) => `${numberFormat.format(count)} ${count === 1 ? u[0] : u[1]}`;

  return (
    <section className="status-summary" data-plain={headline ? undefined : ""} aria-label={headline ? "Resumen por estado" : label}>
      {headline ? (
        <div className="status-summary-lead">
          <div>
            <p className="status-summary-value">{numberFormat.format(headline.value)}</p>
            <p className="mt-1.5 text-sm font-medium text-zinc-900">{headline.label}</p>
            {headline.caption ? <p className="text-xs text-zinc-500">{headline.caption}</p> : null}
          </div>
          {workTotal > 0 ? (
            <div className="meter" role="img" aria-label={work.map((item) => `${item.label}: ${describe(item.count, item.unit)}`).join(", ")}>
              {work
                .filter((item) => item.count > 0)
                .map((item) => (
                  <span key={item.key} className={`tone-${item.tone}`} style={{ flexGrow: item.count }} title={`${item.label}: ${describe(item.count, item.unit)}`} />
                ))}
            </div>
          ) : null}
          {note ? <p className="text-xs leading-snug text-zinc-500">{note}</p> : null}
        </div>
      ) : null}

      <div className="min-w-0">
        <nav aria-label={label} className="status-tabs">
          <Tab label={all.label} count={all.count} href={all.href} active={all.active} srCount={all.count !== undefined ? describe(all.count) : undefined} />
          {[...work, ...history].map(({ key, unit: itemUnit, ...item }) => (
            <Tab key={key} {...item} srCount={describe(item.count, itemUnit)} />
          ))}
        </nav>
        {!headline && note ? <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-600">{note}</p> : null}
      </div>
    </section>
  );
}

interface TabProps {
  label: string;
  count?: number;
  href: string;
  active: boolean;
  tone?: BadgeTone;
  secondary?: boolean;
  srCount?: string;
}

function Tab({ label, count, href, active, tone, secondary, srCount }: TabProps) {
  return (
    <Link href={href} scroll={false} className="status-tab" aria-current={active ? "page" : undefined} data-secondary={secondary || undefined}>
      <span className="status-tab-label">
        {tone ? <span aria-hidden className={`swatch tone-${tone}`} /> : null}
        {label}
      </span>
      {count !== undefined ? (
        <span className="status-tab-count" aria-hidden>
          {numberFormat.format(count)}
        </span>
      ) : (
        <span className="status-tab-count text-zinc-400" aria-hidden>
          &nbsp;
        </span>
      )}
      {srCount ? <span className="sr-only">{srCount}</span> : null}
      <LinkPending />
    </Link>
  );
}
