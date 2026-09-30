/**
 * Layout guard + tab nav for `/admin/accesos/**` ("Usuarios y accesos" in
 * the sidebar's "Administración" group): Usuarios (`usuarios.listar`),
 * Roles (`roles.ver`) and Directores técnicos (`dt.designar`). Admits a
 * session that can reach AT LEAST ONE of them; each section keeps its own
 * nested guard where it needs a narrower one (see
 * `./directores-tecnicos/layout.tsx`). The tab list comes from
 * `../../nav-sections.ts`, which uses exactly the permiso each section's
 * own guard checks, so a tab is never shown for a section the session
 * cannot actually reach.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { accesosSections } from "../../nav-sections";
import { SectionTabs } from "../../section-tabs";

export default async function AccesosLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const links = accesosSections(session);

  if (links.length === 0) {
    redirect("/");
  }

  return (
    <>
      <SectionTabs ariaLabel="Secciones de usuarios y accesos" links={links} />
      {children}
    </>
  );
}
