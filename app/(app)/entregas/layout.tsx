/**
 * Layout guard for `/entregas/**` (FASE 11, M14). `entregas.registrar` is the action permiso this whole section supports.
 * `modal` is the `@modal` slot: opening a receta from the list renders `@modal/(.)[recetaId]` as a pop-up over it; a
 * direct load of `/entregas/[recetaId]` renders the full page instead (and `@modal/default.tsx`, nothing).
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function EntregasLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "entregas.registrar")) {
    redirect("/");
  }

  return (
    <>
      {children}
      {modal}
    </>
  );
}
