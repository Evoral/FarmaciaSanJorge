/**
 * Layout guard for `/pacientes/**` (FASE 4 point 4.5, DP-24: HEALTH-ADJACENT
 * DATA, access strictly by `pacientes.gestionar`). Its own sidebar section
 * under "Gestión" (formerly a `/catalogos` tab -- `next.config.ts` redirects
 * the old `/catalogos/pacientes/**` paths here), so it also provides the
 * `.page` wrapper that `catalogos/layout.tsx` used to.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function PacientesLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "pacientes.gestionar")) {
    redirect("/");
  }

  return <div className="page">{children}</div>;
}
