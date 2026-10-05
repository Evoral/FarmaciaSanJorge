/**
 * Layout guard for `/proveedores/**` (FASE 4 point 4.3). Its own sidebar
 * section under "Gestión" (formerly a `/catalogos` tab -- `next.config.ts`
 * redirects the old `/catalogos/proveedores/**` paths here), so it also
 * provides the `.page` wrapper that `catalogos/layout.tsx` used to.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function ProveedoresLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "proveedores.gestionar")) {
    redirect("/");
  }

  return <div className="page list-view">{children}</div>;
}
