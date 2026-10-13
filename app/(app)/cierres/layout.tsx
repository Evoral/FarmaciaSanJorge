/**
 * Layout guard for `/cierres/**` -- the sidebar's "Gestión DT"
 * section (firmas diarias, vencimientos, ajustes de stock). Same pattern as
 * `../catalogos/layout.tsx`: lets through anyone who can reach AT LEAST ONE
 * tab (`../nav-sections.ts#gestionDtSections`, exactly the permisos each
 * tab's own guard checks -- every tab requires `cierres.ver`); each tab keeps
 * its own guard. Also lets through
 * `cierres.reporte` alone, so `/cierres/reporte` keeps working for a role
 * that holds only that permiso (its page guards it).
 *
 * Unlike catalogos, it adds no `page` wrapper: `/cierres/[id]` and
 * `/cierres/reporte` keep their own page layout, so each page renders its
 * own. The real, per-action boundary is still each use case's
 * `authorize(permiso)`.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { gestionDtSections } from "../nav-sections";

export default async function GestionDtLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (gestionDtSections(session).length === 0 && !can(session, "cierres.reporte")) {
    redirect("/");
  }

  return <>{children}</>;
}
