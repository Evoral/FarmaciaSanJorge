/** Layout guard for `/reportes/recetas` (FASE 13 point 13.4). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function ReporteRecetasLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "reportes.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
