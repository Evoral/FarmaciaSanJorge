/** Layout guard for `/entregas/**` (FASE 11, M14). `entregas.registrar` is the action permiso this whole section supports. */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function EntregasLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "entregas.registrar")) {
    redirect("/");
  }

  return <>{children}</>;
}
