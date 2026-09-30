/**
 * Layout guard for `/admin/configuracion/farmacia/**` (FASE 3 point
 * 3.10a). Allows anyone with `config.ver` (ADMINISTRADOR-only since
 * migration 0046, user decision 2026-09-28) to REACH the section. Editing
 * is a separate permiso, `config.editar`, enforced per-action by
 * `editarDatosTenantCommand`'s own `authorize()` call and, on the UI side,
 * by the edit form only rendering enabled inputs for a session that
 * `can(session, "config.editar")` (see
 * app/(app)/admin/configuracion/farmacia/page.tsx). Same "gate reaching
 * the section, not the action" pattern as the parent layouts
 * (app/(app)/admin/layout.tsx, app/(app)/admin/configuracion/layout.tsx),
 * but those admit the UNION of their sections' permisos, so this nested
 * layout keeps its OWN guard on exactly `config.ver` -- the same permiso
 * app/(app)/nav-sections.ts uses for this section's tab.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function FarmaciaLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "config.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
