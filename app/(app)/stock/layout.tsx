/** Layout guard for `/stock/**` (M07, FASE 5). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function StockLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "stock.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
