/**
 * Layout guard for `/catalogos/**` (FASE 4 points 4.1, 4.2, 4.4).
 * These catalogs are shared across roles (drogas by FAR/DT/ADM,
 * médicos also by ATENCION_PUBLICO, unidades de medida by
 * `unidades.editar` holders -- plan §7) -- allows anyone who can reach AT
 * LEAST ONE nested section through; each section keeps its own nested
 * guard. Each list page renders the tab nav under its header (detail pages
 * use breadcrumbs instead); the tab list comes from `../nav-sections.ts`, which uses exactly
 * the permiso each section's own guard checks. The real, per-action
 * boundary is still each use case's own `authorize(permiso)`.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { catalogosSections } from "../nav-sections";

export default async function CatalogosLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const links = catalogosSections(session);

  if (links.length === 0) {
    redirect("/");
  }

  return (
    <div className="page list-view">
      {children}
    </div>
  );
}
