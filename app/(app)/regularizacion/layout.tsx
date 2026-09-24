/** Layout guard for `/regularizacion` (FASE 11 point 11.3, M14). Gated on `regularizacion.ver`. */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function RegularizacionLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "regularizacion.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
