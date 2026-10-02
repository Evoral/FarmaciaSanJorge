/**
 * Layout for `/proveedores/[id]/**`: back link + the two tabs of a proveedor,
 * "Datos" (edit / baja / reactivar) and "Trayectoria" (read-only history of
 * its partidas). The access guard (`proveedores.gestionar`) is the parent
 * `proveedores/layout.tsx`. `[id]` is an opaque UUID: a malformed one is a 404
 * here, before any page runs. "Datos" is an exact match because its href is a
 * prefix of the Trayectoria one.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { uuid } from "@/shared/validation";
import { SectionTabs } from "../../section-tabs";

interface ProveedorIdLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ProveedorIdLayout({ children, params }: ProveedorIdLayoutProps) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  return (
    <div>
      <div className="mb-2">
        <Link href="/proveedores" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>
      <SectionTabs
        ariaLabel="Secciones del proveedor"
        links={[
          { href: `/proveedores/${id}`, label: "Datos", exact: true },
          { href: `/proveedores/${id}/trayectoria`, label: "Trayectoria" },
        ]}
      />
      {children}
    </div>
  );
}
