/**
 * Linked rows that summarize another screen (dashboards, "what needs me").
 * One component, two densities:
 * - `prominent`: tone tile + title + context/breakdown + big count. For
 *   items that need action, most urgent first.
 * - `compact`: a quiet one-line row. For items that are fine right now.
 * Server Component.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { ToneBadge, type BadgeTone } from "./status-badge";

export interface SummaryBreakdown {
  label: string;
  value: number;
  tone: BadgeTone;
}

export interface SummaryListItem {
  key: string;
  title: string;
  href: string;
  tone: BadgeTone;
  icon: ReactNode;
  description?: string;
  count?: number;
  /** Short flag next to the title, e.g. "Urgente" (only for `danger`). */
  flag?: string;
  breakdown?: readonly SummaryBreakdown[];
}

export interface SummaryListProps {
  items: readonly SummaryListItem[];
  variant?: "prominent" | "compact";
}

const numberFormat = new Intl.NumberFormat("es-AR");

export function SummaryList({ items, variant = "prominent" }: SummaryListProps) {
  const compact = variant === "compact";
  return (
    <ul>
      {items.map((item) => (
        <li key={item.key}>
          <Link href={item.href} className="summary-row" data-compact={compact || undefined}>
            <span className="tone-tile" data-tone={item.tone} aria-hidden>
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={compact ? "text-sm text-zinc-800" : "text-sm font-medium text-zinc-900"}>{item.title}</span>
                {item.flag ? <ToneBadge tone={item.tone}>{item.flag}</ToneBadge> : null}
              </span>
              {item.description ? <span className={`block text-zinc-500 ${compact ? "text-xs" : "mt-0.5 text-[0.8125rem]"}`}>{item.description}</span> : null}
              {item.breakdown && item.breakdown.length > 0 ? (
                <span className="breakdown">
                  {item.breakdown.map((part) => (
                    <span key={part.label}>
                      <span aria-hidden className={`swatch tone-${part.tone}`} />
                      <strong>{numberFormat.format(part.value)}</strong> {part.label}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            {item.count !== undefined && !compact ? (
              <span className="summary-count" data-tone={item.tone}>
                {numberFormat.format(item.count)}
              </span>
            ) : null}
            <ChevronRight className="summary-row-chevron size-4 flex-none" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
