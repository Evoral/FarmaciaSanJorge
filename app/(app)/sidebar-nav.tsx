"use client";

/**
 * Main navigation for every authenticated route (FASE 3 point 3.11: "an
 * Auditoría link in the main header, shown only when can() allows it,
 * mark the current section with aria-current"). Same "small client island
 * for usePathname() only, visibility computed server-side" pattern as
 * `app/(app)/admin/admin-nav.tsx` -- see that file's doc comment.
 *
 * Visual identity 1a: fixed sidebar grouped by workflow (operación,
 * registro legal, gestión). Below `lg` it collapses into a top bar with a
 * menu button that opens the same sidebar as a drawer.
 */
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";

export interface SidebarNavProps {
  /** Display name of the signed-in usuario. */
  usuario: string;
  /** Server action that ends the session. */
  logoutAction: () => Promise<void>;
  /** Jornadas pending signature (0 hides the badge on "Cierres"). */
  cierresPendientes: number;
  puedeAuditoria: boolean;
  /** FASE 13 point 13.1/13.4 (user decision 5): `true` when the session holds ANY report permiso (`reportes.ver`, `stock.valorizado.ver`, `stock.ver`, `cierres.reporte`, `reportes.auditoria`, `reportes.usuarios`) -- shows a "Reportes" link to the `/reportes` hub, which itself re-checks each entry's own permiso. */
  puedeReportes: boolean;
  /**
   * FASE 4 points 4.2-4.5: the FIRST `/catalogos/**` section this session
   * can actually reach, or `null` if none. Deliberately NOT a plain
   * boolean (as it was through point 4.3, always linking to
   * `/catalogos/drogas`) -- FASE 4 point 4.4 (médicos) and 4.5 (pacientes)
   * introduced ATENCION_PUBLICO as a role that can reach `/catalogos` but
   * has NEITHER `drogas.editar` NOR `proveedores.gestionar`. A hardcoded
   * `/catalogos/drogas` link would have sent that role straight into
   * `app/(app)/catalogos/drogas/layout.tsx`'s own permiso guard, which
   * redirects to `/` -- i.e. the link would have been silently broken for
   * that role. The caller (`app/(app)/layout.tsx`) computes this in the
   * SAME priority order as `app/(app)/catalogos/catalogos-nav.tsx`.
   */
  catalogosHref: string | null;
  /** M07, FASE 5: `stock.ver` (granted to every role) -- `true` shows a "Stock" link to `/stock`. */
  puedeStock: boolean;
  /** M09, FASE 6: `recetas.crear` (ATP/FAR/DT) -- `true` shows a "Recetas" link to `/recetas`. */
  puedeRecetas: boolean;
  /** M11, FASE 8: `preparaciones.iniciar` (FAR/DT) -- `true` shows a "Preparaciones" link to `/preparaciones`. */
  puedePreparaciones: boolean;
  /** M12, FASE 9: `libro.ver` (FAR/DT/SOLO_CONSULTA) -- `true` shows a "Libro Recetario" link to `/libro`. */
  puedeLibro: boolean;
  /** M13a, FASE 10: `cierres.ver` (DT/FAR/SOLO_CONSULTA) -- `true` shows a "Cierres" link to `/cierres`. */
  puedeCierres: boolean;
  /** M14, FASE 11: the FIRST section this session can reach for the "Entregas" entry -- `/entregas` (entregas.registrar) or `/regularizacion` (regularizacion.ver only), or `null` if neither. Same priority-order reasoning as `catalogosHref`. */
  entregasHref: string | null;
  /** M15, FASE 12: `archivo.lotes.gestionar` ONLY -- same permiso `/archivo`'s layout guard requires, so this link never sends a `archivo.destruccion.gestionar`-only session into a guard that would just redirect it back out. */
  puedeArchivo: boolean;
}

interface NavItem {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export function SidebarNav(props: SidebarNavProps) {
  const pathname = usePathname();
  // The mobile drawer remembers the route it was opened on, so navigating
  // anywhere closes it without an effect.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (value: boolean) => setOpenedAt(value ? pathname : null);

  const groups = buildGroups(props, pathname);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4 lg:hidden dark:border-zinc-800 dark:bg-zinc-950">
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menú" aria-expanded={open} aria-controls="app-sidebar" className="-ml-1.5 rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
          <Menu className="size-5" aria-hidden />
        </button>
        <Brand />
      </div>

      {open ? <div className="fixed inset-0 z-40 bg-zinc-900/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}

      <aside
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-zinc-200 bg-white transition-transform duration-200 lg:translate-x-0 dark:border-zinc-800 dark:bg-zinc-950 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <Brand />
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((group) => (
            <div key={group.label} className="mt-4 first:mt-2">
              <p className="px-2.5 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-400">{group.label}</p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center gap-2.5 px-1.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{initials(props.usuario)}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{props.usuario}</span>
            <form action={props.logoutAction}>
              <button type="submit" aria-label="Cerrar sesión" title="Cerrar sesión" className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <LogOut className="size-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-md dark:bg-white">
        <Image src="/logo.png" alt="" width={28} height={28} priority />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Lab. Magistral</span>
        <span className="text-[11px] text-zinc-500">Farmacia San Jorge</span>
      </span>
    </Link>
  );
}

function NavLink({ item }: { item: NavItem }) {
  return (
    <Link
      href={item.href}
      aria-current={item.active ? "page" : undefined}
      className={
        item.active
          ? "flex items-center gap-2 rounded bg-emerald-50 px-2.5 py-1.5 text-sm font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : "flex items-center gap-2 rounded px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
      }
    >
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="font-mono text-[11px] font-medium text-amber-600 dark:text-amber-400" aria-label={`${item.badge} pendientes`}>
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function buildGroups(p: SidebarNavProps, pathname: string): NavGroup[] {
  const operacion: NavItem[] = [{ href: "/", label: "Inicio", active: pathname === "/" }];
  if (p.puedeRecetas) operacion.push({ href: "/recetas", label: "Recetas", active: pathname.startsWith("/recetas") });
  if (p.puedePreparaciones) operacion.push({ href: "/preparaciones", label: "Preparaciones", active: pathname.startsWith("/preparaciones") });
  if (p.puedeStock) operacion.push({ href: "/stock", label: "Stock", active: pathname.startsWith("/stock") });
  if (p.entregasHref) operacion.push({ href: p.entregasHref, label: "Entregas", active: pathname.startsWith("/entregas") || pathname.startsWith("/regularizacion") });

  const registro: NavItem[] = [];
  if (p.puedeCierres) registro.push({ href: "/cierres", label: "Cierres", active: pathname.startsWith("/cierres"), badge: p.cierresPendientes });
  if (p.puedeLibro) registro.push({ href: "/libro", label: "Libro Recetario", active: pathname.startsWith("/libro") });
  if (p.puedeArchivo) registro.push({ href: "/archivo", label: "Archivo", active: pathname.startsWith("/archivo") });

  const gestion: NavItem[] = [];
  if (p.catalogosHref) gestion.push({ href: p.catalogosHref, label: "Catálogos", active: pathname.startsWith("/catalogos") });
  if (p.puedeReportes) gestion.push({ href: "/reportes", label: "Reportes", active: pathname.startsWith("/reportes") });
  if (p.puedeAuditoria) gestion.push({ href: "/auditoria", label: "Auditoría", active: pathname === "/auditoria" || pathname.startsWith("/auditoria/") });

  return [
    { label: "Operación", items: operacion },
    { label: "Registro legal", items: registro },
    { label: "Gestión", items: gestion },
  ].filter((group) => group.items.length > 0);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
