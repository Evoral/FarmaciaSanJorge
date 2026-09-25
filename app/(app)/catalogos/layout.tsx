/**
 * Layout guard for `/catalogos/**` (FASE 4 points 4.2/4.3). Unlike
 * `/admin/**` (ADM-only), these catalogs (drogas, proveedores) are shared by
 * FAR/DT/ADM (plan §7) -- allows anyone who can reach AT LEAST ONE nested
 * section through. The real, per-action boundary is still each use case's
 * own `authorize(permiso)`.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { CatalogosNav } from "./catalogos-nav";

export default async function CatalogosLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  const puedeDrogas = can(session, "drogas.editar");
  const puedeProveedores = can(session, "proveedores.gestionar");
  const puedeMedicos = can(session, "medicos.gestionar");
  const puedePacientes = can(session, "pacientes.gestionar");

  if (!puedeDrogas && !puedeProveedores && !puedeMedicos && !puedePacientes) {
    redirect("/");
  }

  return (
    <div className="page">
      <CatalogosNav puedeDrogas={puedeDrogas} puedeProveedores={puedeProveedores} puedeMedicos={puedeMedicos} puedePacientes={puedePacientes} />
      {children}
    </div>
  );
}
