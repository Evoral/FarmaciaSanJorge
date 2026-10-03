/**
 * Footer of a paginated list: the visible range ("21-40 de 380") and page
 * links with ellipses (first, last and the current page's neighbors). On
 * phones only prev/next and "3 / 19" remain. Server Component: the page
 * passes `hrefFor`, which keeps its own filters in the URL.
 */
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
  /** Accessible name, e.g. "Paginación de recetas". */
  label: string;
}

const numberFormat = new Intl.NumberFormat("es-AR");

/** Page numbers to show, with `null` for a gap. */
function pageWindow(page: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= totalPages));
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? [null, p] : [p]));
}

export function Pagination({ page, pageSize, total, hrefFor, label }: PaginationProps) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="pagination">
      <p>
        <span className="font-medium text-zinc-900 tabular-nums">
          {numberFormat.format(from)}-{numberFormat.format(to)}
        </span>{" "}
        de <span className="tabular-nums">{numberFormat.format(total)}</span>
      </p>
      {totalPages > 1 ? (
        <nav aria-label={label} className="flex items-center gap-1">
          <Step href={page > 1 ? hrefFor(page - 1) : null} label="Página anterior">
            <ChevronLeft className="size-4" aria-hidden />
          </Step>
          <span className="px-2 tabular-nums sm:hidden">
            {page} / {totalPages}
          </span>
          <ol className="hidden items-center gap-1 sm:flex">
            {pageWindow(page, totalPages).map((p, i) =>
              p === null ? (
                <li key={`gap-${i}`} aria-hidden className="px-1 text-zinc-400">
                  …
                </li>
              ) : (
                <li key={p}>
                  {p === page ? (
                    <span className="page-link" aria-current="page">
                      {p}
                    </span>
                  ) : (
                    <Link href={hrefFor(p)} className="page-link" aria-label={`Página ${p}`}>
                      {p}
                    </Link>
                  )}
                </li>
              ),
            )}
          </ol>
          <Step href={page < totalPages ? hrefFor(page + 1) : null} label="Página siguiente">
            <ChevronRight className="size-4" aria-hidden />
          </Step>
        </nav>
      ) : null}
    </div>
  );
}

function Step({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  return href ? (
    <Link href={href} className="page-link" aria-label={label}>
      {children}
    </Link>
  ) : (
    <span className="page-link" aria-label={label} aria-disabled="true">
      {children}
    </span>
  );
}
