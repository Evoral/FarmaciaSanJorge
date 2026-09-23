/** Layout guard for `/catalogos/proveedores/**` (FASE 4 point 4.3). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function ProveedoresLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "proveedores.gestionar")) {
    redirect("/");
  }

  return <>{children}</>;
}
