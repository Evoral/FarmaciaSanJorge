/** Layout guard for `/reportes/kardex` (FASE 13 point 13.2). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function ReporteKardexLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "stock.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
