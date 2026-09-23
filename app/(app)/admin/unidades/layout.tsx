/**
 * Layout guard for `/admin/unidades/**` (FASE 4 point 4.1). Same pattern as
 * app/(app)/admin/parametros/layout.tsx: gated on the module's own "can I
 * even manage this" permiso -- there is no dedicated `unidades.ver`
 * (plan §7's matrix), so `unidades.editar` doubles as "may enter the
 * section" (same reuse `modules/unidades/application/list-unidades.ts`
 * already documents).
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function UnidadesLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "unidades.editar")) {
    redirect("/");
  }

  return <>{children}</>;
}
