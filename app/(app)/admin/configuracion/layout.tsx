/**
 * Layout guard + tab nav for `/admin/configuracion/**` ("Configuración" in
 * the sidebar's "Administración" group): Farmacia and Parámetros
 * (`config.ver`, ADMINISTRADOR-only since migration 0046; editing is further
 * gated per-action on `config.editar`) and Reglas de precio
 * (`precios.reglas.editar`, ADM/DT -- the deliberate exception that lets a
 * DIRECTOR_TECNICO in here with that single tab). Admits a session that can reach AT
 * LEAST ONE of them; each section keeps its own nested guard. The tab list
 * comes from `../../nav-sections.ts`, which uses exactly the permiso each
 * section's own guard checks, so a tab is never shown for a section the
 * session cannot actually reach.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { configuracionSections } from "../../nav-sections";
import { SectionTabs } from "../../section-tabs";

export default async function ConfiguracionLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const links = configuracionSections(session);

  if (links.length === 0) {
    redirect("/");
  }

  return (
    <>
      <SectionTabs ariaLabel="Secciones de configuración" links={links} />
      {children}
    </>
  );
}
