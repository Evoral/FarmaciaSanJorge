/**
 * Layout for `/pacientes/[id]/**`: only the uuid guard. Each page renders its own header (breadcrumbs back to the
 * list) and the paciente's "Datos | Historial" tabs (`PacienteTabs`, ../pacientes-tabs.tsx), so the tabs sit under
 * the paciente's name. The access guard (`pacientes.gestionar`) is the parent `pacientes/layout.tsx`.
 * HEALTH-ADJACENT DATA (DP-24): `[id]` is an opaque UUID, nothing identifying goes in these hrefs.
 */
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { uuid } from "@/shared/validation";

interface PacienteIdLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function PacienteIdLayout({ children, params }: PacienteIdLayoutProps) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  return <>{children}</>;
}
