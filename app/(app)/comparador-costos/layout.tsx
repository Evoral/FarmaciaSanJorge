/**
 * Layout guard for `/comparador-costos` (docs/specs/comparador-costos.md). Its
 * own sidebar entry under "Gestión", gated on `stock.valorizado.ver` (the
 * permiso that gates money everywhere else; ADM/DT/FAR today), the same one
 * the use case requires. Also provides the `.page` wrapper, like
 * `proveedores/layout.tsx`.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function ComparadorCostosLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "stock.valorizado.ver")) {
    redirect("/");
  }

  return <div className="page list-view">{children}</div>;
}
