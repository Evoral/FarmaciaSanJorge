/**
 * Layout guard for `/admin/farmacia/**` (FASE 3 point 3.10a). Allows anyone
 * with `config.ver` (granted to ALL FIVE roles, migration 0002) to REACH
 * the section -- the real boundary is `config.editar`, enforced per-action
 * by `editarDatosTenantCommand`'s own `authorize()` call and, on the UI
 * side, by the edit form only rendering enabled inputs for a session that
 * `can(session, "config.editar")` (see app/(app)/admin/farmacia/page.tsx).
 * Mirrors app/(app)/admin/layout.tsx's "gate reaching the section, not the
 * action" pattern -- that file is out of scope for this task (handled
 * centrally by the orchestrator), so this nested layout adds its OWN guard
 * instead of relying on the parent's (which currently checks
 * usuarios.listar/roles.ver, not config.ver).
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
