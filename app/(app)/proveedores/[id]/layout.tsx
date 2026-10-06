/**
 * Layout for `/proveedores/[id]/**`: only the uuid guard (a malformed id is a 404 here, before any page runs). Each
 * page renders its own header (breadcrumbs back to the list) and the proveedor's "Datos | Historial" tabs
 * (`ProveedorTabs`, ../proveedor-tabs.tsx), so the tabs sit under the proveedor's name. The access guard
 * (`proveedores.gestionar`) is the parent `proveedores/layout.tsx`.
 */
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { uuid } from "@/shared/validation";

interface ProveedorIdLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ProveedorIdLayout({ children, params }: ProveedorIdLayoutProps) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  return <>{children}</>;
}
