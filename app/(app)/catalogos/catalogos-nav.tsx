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
    <nav aria-label="Secciones de catálogos" className="mb-6 flex flex-wrap gap-4 border-b border-zinc-200 pb-3 text-sm dark:border-zinc-800">
      {links.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} aria-current={isActive ? "page" : undefined} className={isActive ? "font-medium underline" : "text-zinc-600 hover:underline dark:text-zinc-400"}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
