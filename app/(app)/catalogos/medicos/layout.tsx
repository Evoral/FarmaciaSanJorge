/** Layout guard for `/catalogos/medicos/**` (FASE 4 point 4.4). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function MedicosLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "medicos.gestionar")) {
    redirect("/");
  }

  return <>{children}</>;
}
