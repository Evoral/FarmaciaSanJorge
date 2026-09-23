/** Layout guard for `/catalogos/pacientes/**` (FASE 4 point 4.5, DP-24: HEALTH-ADJACENT DATA, access strictly by `pacientes.gestionar`). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function PacientesLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "pacientes.gestionar")) {
    redirect("/");
  }

  return <>{children}</>;
}
