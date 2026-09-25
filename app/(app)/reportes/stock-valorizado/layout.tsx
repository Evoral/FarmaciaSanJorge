/** Layout guard for `/reportes/stock-valorizado` (FASE 13 point 13.2, migration 0043). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function ReporteStockValorizadoLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "stock.valorizado.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
