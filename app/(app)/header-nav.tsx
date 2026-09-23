"use client";

/**
 * Main header nav for every authenticated route (FASE 3 point 3.11: "an
 * Auditoría link in the main header, shown only when can() allows it,
 * mark the current section with aria-current"). Same "small client island
 * for usePathname() only, visibility computed server-side" pattern as
 * `app/(app)/admin/admin-nav.tsx` -- see that file's doc comment.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface HeaderNavProps {
  puedeAuditoria: boolean;
  /**
   * FASE 4 points 4.2-4.5: the FIRST `/catalogos/**` section this session
   * can actually reach, or `null` if none. Deliberately NOT a plain
   * boolean (as it was through point 4.3, always linking to
   * `/catalogos/drogas`) -- FASE 4 point 4.4 (médicos) and 4.5 (pacientes)
   * introduced ATENCION_PUBLICO as a role that can reach `/catalogos` but
   * has NEITHER `drogas.editar` NOR `proveedores.gestionar`. A hardcoded
   * `/catalogos/drogas` link would have sent that role straight into
   * `app/(app)/catalogos/drogas/layout.tsx`'s own permiso guard, which
   * redirects to `/` -- i.e. the header link would have been silently
   * broken for that role. The caller (`app/(app)/layout.tsx`) computes
   * this in the SAME priority order as `app/(app)/catalogos/catalogos-nav.tsx`.
   */
  catalogosHref: string | null;
  /** M07, FASE 5: `stock.ver` (granted to every role) -- `true` shows a "Stock" link to `/stock`. */
  puedeStock: boolean;
  /** M09, FASE 6: `recetas.crear` (ATP/FAR/DT) -- `true` shows a "Recetas" link to `/recetas`. */
  puedeRecetas: boolean;
  /** M11, FASE 8: `preparaciones.iniciar` (FAR/DT) -- `true` shows a "Preparaciones" link to `/preparaciones`. */
  puedePreparaciones: boolean;
  /** M12, FASE 9: `libro.ver` (FAR/DT/SOLO_CONSULTA) -- `true` shows a "Libro" link to `/libro`. */
  puedeLibro: boolean;
}

export function HeaderNav({ puedeAuditoria, catalogosHref, puedeStock, puedeRecetas, puedePreparaciones, puedeLibro }: HeaderNavProps) {
  const pathname = usePathname();

  if (!puedeAuditoria && !catalogosHref && !puedeStock && !puedeRecetas && !puedePreparaciones && !puedeLibro) return null;

  const auditoriaActiva = pathname === "/auditoria" || pathname.startsWith("/auditoria/");
  const catalogosActivos = pathname.startsWith("/catalogos");
  const stockActivo = pathname.startsWith("/stock");
  const recetasActivo = pathname.startsWith("/recetas");
  const preparacionesActivo = pathname.startsWith("/preparaciones");
  const libroActivo = pathname.startsWith("/libro");

  return (
    <nav aria-label="Navegación principal" className="flex items-center gap-4">
      {puedeRecetas ? (
        <Link
          href="/recetas"
          aria-current={recetasActivo ? "page" : undefined}
          className={recetasActivo ? "text-sm font-medium underline" : "text-sm text-zinc-600 hover:underline dark:text-zinc-400"}
        >
          Recetas
        </Link>
      ) : null}
      {puedePreparaciones ? (
        <Link
          href="/preparaciones"
          aria-current={preparacionesActivo ? "page" : undefined}
          className={preparacionesActivo ? "text-sm font-medium underline" : "text-sm text-zinc-600 hover:underline dark:text-zinc-400"}
        >
          Preparaciones
        </Link>
      ) : null}
      {catalogosHref ? (
        <Link
          href={catalogosHref}
          aria-current={catalogosActivos ? "page" : undefined}
          className={catalogosActivos ? "text-sm font-medium underline" : "text-sm text-zinc-600 hover:underline dark:text-zinc-400"}
        >
          Catálogos
        </Link>
      ) : null}
      {puedeStock ? (
        <Link
          href="/stock"
          aria-current={stockActivo ? "page" : undefined}
          className={stockActivo ? "text-sm font-medium underline" : "text-sm text-zinc-600 hover:underline dark:text-zinc-400"}
        >
          Stock
        </Link>
      ) : null}
      {puedeLibro ? (
        <Link
          href="/libro"
          aria-current={libroActivo ? "page" : undefined}
          className={libroActivo ? "text-sm font-medium underline" : "text-sm text-zinc-600 hover:underline dark:text-zinc-400"}
        >
          Libro
        </Link>
      ) : null}
      {puedeAuditoria ? (
        <Link
          href="/auditoria"
          aria-current={auditoriaActiva ? "page" : undefined}
          className={auditoriaActiva ? "text-sm font-medium underline" : "text-sm text-zinc-600 hover:underline dark:text-zinc-400"}
        >
          Auditoría
        </Link>
      ) : null}
    </nav>
  );
}
