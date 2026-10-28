/**
 * Layout guard for `/costos-proveedor/**` (openspec/specs/costos-proveedor/spec.md R35). Its own
 * sidebar entry under "Gestión", gated on `stock.valorizado.ver` (the permiso that gates
 * money everywhere else), the same one the consultation use cases require. The write
 * pages and actions check `costos.proveedor.gestionar` on top (R36). Provides the `.page`
 * wrapper and the ONE `Toaster` of the section: it lives here, not in each page, so the
 * confirmation of a save still shows after the form redirects to the list.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { Toaster } from "@/shared/ui/toast";

export default async function CostosProveedorLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "stock.valorizado.ver")) {
    redirect("/");
  }

  return (
    <div className="page list-view">
      {children}
      <Toaster />
    </div>
  );
}
