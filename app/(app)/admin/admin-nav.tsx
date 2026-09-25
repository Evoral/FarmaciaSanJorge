"use client";

/**
 * Section nav for `/admin/**` (FASE 3 points 3.9/3.10, task instruction:
 * "Add an admin nav (Usuarios, Roles, Directores técnicos, Farmacia,
 * Parámetros) ... show each link only when can() allows it"). Visibility
 * is computed server-side in `./layout.tsx` (one `can()` check per section,
 * same permiso each section's OWN nested layout guards on) and passed down
 * as plain booleans -- this component only needs `usePathname()` (a Client
 * Component hook, see `node_modules/next/dist/docs/.../use-pathname.md`)
 * to mark the current section, so it is the smallest possible client
 * island rather than making the whole layout a Client Component.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface AdminNavProps {
  puedeUsuarios: boolean;
  puedeRoles: boolean;
  puedeDirectoresTecnicos: boolean;
  puedeFarmacia: boolean;
  puedeParametros: boolean;
  puedeUnidades: boolean;
  puedePrecios: boolean;
}

interface AdminNavLink {
  href: string;
  label: string;
  visible: boolean;
}

export function AdminNav({ puedeUsuarios, puedeRoles, puedeDirectoresTecnicos, puedeFarmacia, puedeParametros, puedeUnidades, puedePrecios }: AdminNavProps) {
  const pathname = usePathname();

  const links: AdminNavLink[] = [
    { href: "/admin/usuarios", label: "Usuarios", visible: puedeUsuarios },
    { href: "/admin/roles", label: "Roles", visible: puedeRoles },
    { href: "/admin/directores-tecnicos", label: "Directores técnicos", visible: puedeDirectoresTecnicos },
    { href: "/admin/farmacia", label: "Farmacia", visible: puedeFarmacia },
    { href: "/admin/parametros", label: "Parámetros", visible: puedeParametros },
    { href: "/admin/unidades", label: "Unidades de medida", visible: puedeUnidades },
    { href: "/admin/precios", label: "Reglas de precio", visible: puedePrecios },
  ].filter((link) => link.visible);

  if (links.length === 0) return null;

  return (
    <nav
      aria-label="Secciones de administración"
      className="mb-6 flex flex-wrap gap-x-5 border-b border-zinc-200 text-sm dark:border-zinc-800"
    >
      {links.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
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
