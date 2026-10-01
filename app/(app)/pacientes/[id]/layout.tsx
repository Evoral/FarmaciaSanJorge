/**
 * Layout for `/pacientes/[id]/**`: back link + the two tabs of a paciente,
 * "Datos" (edit / baja / reactivar) and "Trayectoria" (read-only history).
 * The access guard (`pacientes.gestionar`) is the parent `pacientes/layout.tsx`.
 * HEALTH-ADJACENT DATA (DP-24): `[id]` is an opaque UUID, nothing identifying
 * goes in these hrefs. "Datos" is an exact match because its href is a prefix
 * of the Trayectoria one.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { uuid } from "@/shared/validation";
import { SectionTabs } from "../../section-tabs";

interface PacienteIdLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function PacienteIdLayout({ children, params }: PacienteIdLayoutProps) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  return (
    <div>
      <div className="mb-2">
        <Link href="/pacientes" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>
      <SectionTabs
        ariaLabel="Secciones del paciente"
        links={[
          { href: `/pacientes/${id}`, label: "Datos", exact: true },
          { href: `/pacientes/${id}/trayectoria`, label: "Trayectoria" },
        ]}
      />
      {children}
    </div>
  );
}
