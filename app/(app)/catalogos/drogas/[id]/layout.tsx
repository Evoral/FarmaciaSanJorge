/**
 * Layout for `/catalogos/drogas/[id]/**`: only the uuid guard (a malformed id is a 404 here, before the Datos
 * use case would throw a ValidationError). Each page renders its own header (breadcrumbs back to the list) and the
 * droga's "Datos | Historial" tabs (`DrogaTabs`, ../droga-tabs.tsx), so the tabs sit under the droga's name. The access
 * guard (`drogas.editar`) is the parent `catalogos/drogas/layout.tsx`. Layouts and pages render independently, so the
 * Historial page repeats the uuid check itself.
 */
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { uuid } from "@/shared/validation";

interface DrogaIdLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function DrogaIdLayout({ children, params }: DrogaIdLayoutProps) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  return <>{children}</>;
}
