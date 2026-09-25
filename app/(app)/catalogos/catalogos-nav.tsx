"use client";

/** Section nav for `/catalogos/**` -- same pattern as app/(app)/admin/admin-nav.tsx. */
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface CatalogosNavProps {
  puedeDrogas: boolean;
  puedeProveedores: boolean;
  puedeMedicos: boolean;
  puedePacientes: boolean;
}

export function CatalogosNav({ puedeDrogas, puedeProveedores, puedeMedicos, puedePacientes }: CatalogosNavProps) {
  const pathname = usePathname();

  const links = [
    { href: "/catalogos/drogas", label: "Drogas", visible: puedeDrogas },
    { href: "/catalogos/proveedores", label: "Proveedores", visible: puedeProveedores },
    { href: "/catalogos/medicos", label: "Médicos", visible: puedeMedicos },
    { href: "/catalogos/pacientes", label: "Pacientes", visible: puedePacientes },
  ].filter((link) => link.visible);

  if (links.length === 0) return null;

  return (
    <nav aria-label="Secciones de catálogos" className="mb-6 flex flex-wrap gap-x-5 border-b border-zinc-200 text-sm dark:border-zinc-800">
      {links.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} aria-current={isActive ? "page" : undefined} className={isActive ? "-mb-px border-b-2 border-emerald-600 pb-2.5 font-medium text-zinc-900 dark:border-emerald-400 dark:text-zinc-100" : "-mb-px border-b-2 border-transparent pb-2.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
