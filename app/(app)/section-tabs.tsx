"use client";

/**
 * Generic tab nav for a sidebar section's sub-sections -- used by
 * `/catalogos/**`, `/admin/accesos/**` and `/admin/configuracion/**`
 * (originally FASE 3 points 3.9/3.10's admin nav: "show each link only when
 * can() allows it"). The links arrive ALREADY filtered server-side by
 * `./nav-sections.ts` (one `can()` check per section, the same permiso
 * each section's OWN nested layout guards on), so this component only needs
 * `usePathname()` (a Client Component hook, see
 * `node_modules/next/dist/docs/.../use-pathname.md`) to mark the current
 * section -- the smallest possible client island rather than making the
 * whole layout a Client Component.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SectionLink } from "./nav-sections";

export interface SectionTabsProps {
  /** Accessible name for the `<nav>` landmark (e.g. "Secciones de catálogos"). */
  ariaLabel: string;
  links: readonly SectionLink[];
}

export function SectionTabs({ ariaLabel, links }: SectionTabsProps) {
  const pathname = usePathname();

  if (links.length === 0) return null;

  return (
    <nav aria-label={ariaLabel} className="mb-6 flex flex-wrap gap-x-5 border-b border-zinc-200 text-sm dark:border-zinc-800">
      {links.map((link) => {
        const isActive = pathname === link.href || (!link.exact && pathname.startsWith(`${link.href}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={isActive ? "-mb-px border-b-2 border-emerald-600 pb-2.5 font-medium text-zinc-900 dark:border-emerald-400 dark:text-zinc-100" : "-mb-px border-b-2 border-transparent pb-2.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
