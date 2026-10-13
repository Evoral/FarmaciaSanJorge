/** Layout guard for `/cierres/ajustes` ("Gestión DT › Ajustes de stock"): `stock.ver`, the same permiso `/stock/ajustes` is guarded on (`app/(app)/stock/layout.tsx`), plus `cierres.ver` like the whole section -- exactly its tab's visibility in `../../nav-sections.ts#gestionDtSections`. */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function AjustesDtLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "cierres.ver") || !can(session, "stock.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
