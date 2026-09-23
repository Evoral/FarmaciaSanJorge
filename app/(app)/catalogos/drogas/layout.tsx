/** Layout guard for `/catalogos/drogas/**` (FASE 4 point 4.2). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function DrogasLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "drogas.editar")) {
    redirect("/");
  }

  return <>{children}</>;
}
