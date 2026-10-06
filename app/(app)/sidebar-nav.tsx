"use client";

/**
 * Main navigation for every authenticated route (FASE 3 point 3.11: "an
 * Auditoría link in the main header, shown only when can() allows it,
 * mark the current section with aria-current"). Same "small client island
 * for usePathname() only, visibility computed server-side" pattern as
 * `app/(app)/section-tabs.tsx` -- see that file's doc comment.
 *
 * Visual identity 1a: fixed sidebar grouped by workflow (operación,
 * registro legal, gestión, administración). Below `lg` it collapses into a
 * top bar with a menu button that opens the same sidebar as a drawer.
 * Entries backed by tabbed sub-sections (Catálogos, Usuarios y accesos,
 * Configuración) link to the FIRST sub-section the session can reach,
 * computed server-side from `app/(app)/nav-sections.ts`.
 *
 * On desktop the sidebar can be collapsed into a slim rail that keeps one
 * icon per entry (label in a tooltip); the mobile drawer has no rail. The
 * state is owned by `./app-shell.tsx` (which also moves the content gutter). The
 * glass look is pure CSS (`.glass-panel`, `.glass-pill` in globals.css): no JS,
 * no SVG filters, and only `translate`/`visibility` are animated.
 */
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Archive,
  BookOpen,
  CalendarCheck,
  ChartColumn,
  FileText,
  FlaskConical,
  House,
  LibraryBig,
  LogOut,
  Menu,
  Package,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Scale,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

export interface SidebarNavProps {
  /** Display name of the signed-in usuario. */
  usuario: string;
  /** Server action that ends the session. */
  logoutAction: () => Promise<void>;
  /** Jornadas pending signature (0 hides the badge on "Cierres"). */
  cierresPendientes: number;
  puedeAuditoria: boolean;
  /** FASE 13 point 13.1/13.4 (user decision 5): `true` when the session holds ANY report permiso (`reportes.ver`, `stock.valorizado.ver`, `stock.ver`, `cierres.reporte`, `reportes.auditoria`) -- shows a "Reportes" link to the `/reportes` hub, which itself re-checks each entry's own permiso. */
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
   * that role. The caller (`app/(app)/layout.tsx`) computes this from
   * `app/(app)/nav-sections.ts#catalogosSections`, the same list (and
   * priority order) that drives the `/catalogos` tab nav and guards.
   */
  catalogosHref: string | null;
  /** M06, FASE 4 point 4.5: `pacientes.gestionar` -- `true` shows "Gestión › Pacientes" to `/pacientes` (its own section, formerly a `/catalogos` tab). Same permiso `app/(app)/pacientes/layout.tsx`'s guard requires. */
  puedePacientes: boolean;
  /** M06, FASE 4 point 4.3: `proveedores.gestionar` -- `true` shows "Gestión › Proveedores" to `/proveedores` (its own section, formerly a `/catalogos` tab). Same permiso `app/(app)/proveedores/layout.tsx`'s guard requires. */
  puedeProveedores: boolean;
  /** `stock.valorizado.ver` (ADM/DT/FAR) -- `true` shows "Gestión › Comparador de costos" to `/comparador-costos`, right below Proveedores. Same permiso `app/(app)/comparador-costos/layout.tsx` guard requires. */
  puedeComparadorCostos: boolean;
  /** "Administración › Usuarios y accesos": the FIRST `/admin/accesos/**` section (usuarios, roles, directores técnicos) this session can reach, or `null` to hide the entry. Same reasoning as `catalogosHref`, from `nav-sections.ts#accesosSections`. */
  accesosHref: string | null;
  /** "Administración › Configuración": the FIRST `/admin/configuracion/**` section (farmacia, parámetros, reglas de precio) this session can reach, or `null` to hide the entry. Same reasoning as `catalogosHref`, from `nav-sections.ts#configuracionSections`. */
  configuracionHref: string | null;
  /** M07, FASE 5: `stock.ver` (granted to every role) -- `true` shows the "Stock" link to `/stock` and, right below it, "Ajustes" to `/stock/ajustes` (same permiso: its list query and the `/stock/**` layout guard both check `stock.ver`). */
  puedeStock: boolean;
  /** M09, FASE 6: `recetas.crear` (ATP/FAR/DT) -- `true` shows a "Recetas" link to `/recetas`. */
  puedeRecetas: boolean;
  /** M11, FASE 8: `preparaciones.iniciar` (FAR/DT) -- `true` shows a "Preparaciones" link to `/preparaciones`. */
  puedePreparaciones: boolean;
  /** M12, FASE 9: `libro.ver` (FAR/DT/SOLO_CONSULTA) -- `true` shows a "Libro Recetario" link to `/libro`. */
  puedeLibro: boolean;
  /** M13a, FASE 10: `cierres.ver` (DT/FAR/SOLO_CONSULTA) -- `true` shows a "Cierres" link to `/cierres`. */
  puedeCierres: boolean;
  /** M14, FASE 11: `/entregas` when the session holds `entregas.registrar` (the permiso its layout guard requires), or `null` to hide the "Entregas" entry. */
  entregasHref: string | null;
  /** M15, FASE 12: `archivo.lotes.gestionar` ONLY -- same permiso `/archivo`'s layout guard requires, so this link never sends a `archivo.destruccion.gestionar`-only session into a guard that would just redirect it back out. */
  puedeArchivo: boolean;
  /** Desktop only: `true` hides the sidebar behind a slim rail. Owned by `./app-shell.tsx`. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  badge?: number;
}

/** Rail tooltip: label + viewport `top` of the hovered/focused icon (fixed-positioned, so the rail's scroll box never clips it). */
interface RailTip {
  label: string;
  top: number;
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

  // Each desktop toggle button disappears when it is used (the aside turns `invisible`, the rail unmounts), which would drop keyboard focus on <body>.
  // The button sets which counterpart should take focus; the effect applies it once the new state is committed. Stays null on first render and for
  // changes that did not come from these buttons, so focus is never stolen.
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef<"collapse-button" | "expand-button" | null>(null);
  const { collapsed } = props;

  useEffect(() => {
    const target = focusAfterToggle.current;
    focusAfterToggle.current = null;
    if (target === "expand-button") expandButtonRef.current?.focus();
    else if (target === "collapse-button") collapseButtonRef.current?.focus();
  }, [collapsed]);

  function collapseSidebar() {
    focusAfterToggle.current = "expand-button";
    props.onCollapsedChange(true);
  }

  function expandSidebar() {
    focusAfterToggle.current = "collapse-button";
    props.onCollapsedChange(false);
  }

  const groups = buildGroups(props, pathname);

  return (
    <>
      {/* Mobile top bar */}
      <div className="glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200/70 px-4 lg:hidden dark:border-zinc-800/70">
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menú" aria-expanded={open} aria-controls="app-sidebar" className="glass-icon-btn -ml-1.5">
          <Menu className="size-5" aria-hidden />
        </button>
        <Brand />
      </div>

      {open ? <div className="fixed inset-0 z-40 bg-zinc-900/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}

      {/* Desktop collapsed rail: one icon per section (label in a tooltip), in its own gutter so it never overlaps page content. */}
      {props.collapsed ? <CollapsedRail groups={groups} usuario={props.usuario} logoutAction={props.logoutAction} expandButtonRef={expandButtonRef} onExpand={expandSidebar} /> : null}

      <aside
        id="app-sidebar"
        // `visibility` flips at once when showing (so the toggle effect can focus inside right away) and only after the 200ms slide when hiding.
        className={`glass-panel fixed inset-y-2 left-2 z-50 flex w-60 flex-col motion-reduce:transition-none! lg:inset-y-3 lg:left-3 ${open ? "visible translate-x-0 [transition:translate_200ms_ease-out,visibility_0s]" : "invisible -translate-x-[calc(100%+1rem)] [transition:translate_200ms_ease-out,visibility_0s_linear_200ms]"} ${props.collapsed ? "lg:invisible lg:-translate-x-[calc(100%+1rem)] lg:[transition:translate_200ms_ease-out,visibility_0s_linear_200ms]" : "lg:visible lg:translate-x-0 lg:[transition:translate_200ms_ease-out,visibility_0s]"}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <Brand />
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="glass-icon-btn -mr-1.5 lg:hidden">
            <X className="size-5" aria-hidden />
          </button>
          <button ref={collapseButtonRef} type="button" onClick={collapseSidebar} aria-label="Contraer barra lateral" title="Contraer barra lateral" aria-expanded aria-controls="app-sidebar" className="glass-icon-btn -mr-1.5 hidden lg:inline-flex">
            <PanelLeftClose className="size-4" aria-hidden />
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

        <div className="shrink-0 border-t border-emerald-900/[0.07] p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.55)] dark:border-zinc-800">
          <div className="flex items-center gap-2.5 px-1.5">
            <span className="glass-pill flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-emerald-800 dark:text-emerald-300">{initials(props.usuario)}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{props.usuario}</span>
            <form action={props.logoutAction}>
              <button type="submit" aria-label="Cerrar sesión" title="Cerrar sesión" className="glass-icon-btn">
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

function CollapsedRail({ groups, usuario, logoutAction, onExpand, expandButtonRef }: { groups: NavGroup[]; usuario: string; logoutAction: () => Promise<void>; onExpand: () => void; expandButtonRef: RefObject<HTMLButtonElement | null> }) {
  const [tip, setTip] = useState<RailTip | null>(null);

  // Mouse and keyboard focus both show the tooltip, anchored to the element's vertical center.
  const tipHandlers = (label: string) => ({
    onMouseEnter: (e: { currentTarget: HTMLElement }) => setTip(tipFor(e.currentTarget, label)),
    onMouseLeave: () => setTip(null),
    onFocus: (e: { currentTarget: HTMLElement }) => setTip(tipFor(e.currentTarget, label)),
    onBlur: () => setTip(null),
  });

  return (
    <>
      <div className="glass-panel fixed inset-y-3 left-3 z-40 hidden w-12 flex-col items-center lg:flex">
        <div className="flex h-14 shrink-0 items-center">
          <button ref={expandButtonRef} type="button" onClick={onExpand} aria-label="Expandir barra lateral" aria-expanded={false} aria-controls="app-sidebar" className="glass-pill glass-icon-btn text-zinc-700" {...tipHandlers("Expandir barra lateral")}>
            <PanelLeftOpen className="size-4" aria-hidden />
          </button>
        </div>

        <nav aria-label="Navegación principal" className="flex w-full flex-1 flex-col items-center overflow-y-auto pb-2" onScroll={() => setTip(null)}>
          {groups.map((group) => (
            <ul key={group.label} aria-label={group.label} className="flex w-full flex-col items-center gap-0.5 border-t border-emerald-900/[0.07] py-2 first:border-t-0 first:pt-0 dark:border-zinc-800">
              {group.items.map((item) => {
                const Icon = item.icon;
                const label = item.badge ? `${item.label} (${item.badge} pendientes)` : item.label;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={item.active ? "page" : undefined}
                      aria-label={label}
                      className={`relative flex size-9 items-center justify-center rounded-[10px] ${item.active ? "glass-pill text-emerald-800 dark:text-emerald-300" : "text-zinc-500 transition-colors duration-100 hover:bg-white/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"}`}
                      {...tipHandlers(label)}
                    >
                      <Icon className="size-4" aria-hidden />
                      {item.badge ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-500" aria-hidden /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
        </nav>

        <div className="flex shrink-0 justify-center border-t border-emerald-900/[0.07] py-2 dark:border-zinc-800">
          <form action={logoutAction}>
            <button type="submit" aria-label={`Cerrar sesión (${usuario})`} className="glass-icon-btn" {...tipHandlers(`Cerrar sesión (${usuario})`)}>
              <LogOut className="size-4" aria-hidden />
            </button>
          </form>
        </div>
      </div>

      {/* Outside `.glass-panel` on purpose: its backdrop-filter would become the containing block of a fixed child and offset it. */}
      {tip ? (
        <span role="tooltip" aria-hidden className="pointer-events-none fixed left-[4.25rem] z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white shadow-md dark:bg-zinc-100 dark:text-zinc-900" style={{ top: tip.top }}>
          {tip.label}
        </span>
      ) : null}
    </>
  );
}

function tipFor(el: HTMLElement, label: string): RailTip {
  const rect = el.getBoundingClientRect();
  return { label, top: rect.top + rect.height / 2 };
}

function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={item.active ? "page" : undefined}
      className={
        item.active
          ? "glass-pill flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-sm font-medium text-emerald-800 dark:text-emerald-300"
          : "flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-sm text-zinc-600 transition-colors duration-100 hover:bg-white/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"
      }
    >
      <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
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
  const operacion: NavItem[] = [{ href: "/", label: "Inicio", icon: House, active: pathname === "/" }];
  if (p.puedeRecetas) operacion.push({ href: "/recetas", label: "Recetas", icon: FileText, active: pathname.startsWith("/recetas") });
  if (p.puedePreparaciones) operacion.push({ href: "/preparaciones", label: "Preparaciones", icon: FlaskConical, active: pathname.startsWith("/preparaciones") });
  if (p.puedeStock) {
    // `/stock/ajustes/**` has its own entry, so it must not light up "Stock" too.
    const enAjustes = pathname === "/stock/ajustes" || pathname.startsWith("/stock/ajustes/");
    operacion.push({ href: "/stock", label: "Stock", icon: Package, active: pathname.startsWith("/stock") && !enAjustes });
    operacion.push({ href: "/stock/ajustes", label: "Ajustes", icon: SlidersHorizontal, active: enAjustes });
  }
  if (p.entregasHref) operacion.push({ href: p.entregasHref, label: "Entregas", icon: PackageCheck, active: pathname.startsWith("/entregas") });

  const registro: NavItem[] = [];
  if (p.puedeCierres) registro.push({ href: "/cierres", label: "Cierres", icon: CalendarCheck, active: pathname.startsWith("/cierres"), badge: p.cierresPendientes });
  if (p.puedeLibro) registro.push({ href: "/libro", label: "Libro Recetario", icon: BookOpen, active: pathname.startsWith("/libro") });
  if (p.puedeArchivo) registro.push({ href: "/archivo", label: "Archivo de recetas", icon: Archive, active: pathname.startsWith("/archivo") });

  const gestion: NavItem[] = [];
  if (p.catalogosHref) gestion.push({ href: p.catalogosHref, label: "Catálogos", icon: LibraryBig, active: pathname.startsWith("/catalogos") });
  if (p.puedePacientes) gestion.push({ href: "/pacientes", label: "Pacientes", icon: Users, active: pathname.startsWith("/pacientes") });
  if (p.puedeProveedores) gestion.push({ href: "/proveedores", label: "Proveedores", icon: Truck, active: pathname.startsWith("/proveedores") });
  if (p.puedeComparadorCostos) gestion.push({ href: "/comparador-costos", label: "Comparador de costos", icon: Scale, active: pathname.startsWith("/comparador-costos") });
  if (p.puedeReportes) gestion.push({ href: "/reportes", label: "Reportes", icon: ChartColumn, active: pathname.startsWith("/reportes") });
  if (p.puedeAuditoria) gestion.push({ href: "/auditoria", label: "Auditoría", icon: ShieldCheck, active: pathname === "/auditoria" || pathname.startsWith("/auditoria/") });

  const administracion: NavItem[] = [];
  if (p.accesosHref) administracion.push({ href: p.accesosHref, label: "Usuarios y accesos", icon: UserCog, active: pathname.startsWith("/admin/accesos") });
  if (p.configuracionHref) administracion.push({ href: p.configuracionHref, label: "Configuración", icon: Settings, active: pathname.startsWith("/admin/configuracion") });

  return [
    { label: "Operación", items: operacion },
    { label: "Registro legal", items: registro },
    { label: "Gestión", items: gestion },
    { label: "Administración", items: administracion },
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
