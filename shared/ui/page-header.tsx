/**
 * Screen header for list and detail pages: optional breadcrumbs, the title,
 * a one-line description and the page's actions (primary last, so it sits
 * at the trailing edge where the eye lands). Server Component.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface Breadcrumb {
  label: string;
  /** Omitted for the current page (the last crumb) and for a grouping with no page of its own (e.g. "Catálogos"). */
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: readonly Breadcrumb[];
  /** Secondary actions first, the primary action last. */
  actions?: ReactNode;
}

export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Ruta de navegación" className="breadcrumbs mb-2">
            <ol>
              {breadcrumbs.map((crumb, i) => (
                <li key={crumb.label} className="inline-flex items-center gap-1">
                  {i > 0 ? <ChevronRight className="size-3 text-zinc-400" aria-hidden /> : null}
                  {crumb.href ? (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  ) : (
                    <span aria-current={i === breadcrumbs.length - 1 ? "page" : undefined} className={i === breadcrumbs.length - 1 ? "text-zinc-700" : undefined}>
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 max-w-[65ch] text-sm text-zinc-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
