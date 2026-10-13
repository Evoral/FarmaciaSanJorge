/** Layout guard for `/cierres/vencimientos` ("Gestión DT › Vencimientos"): `stock.ver`, the permiso of the stock alert queries behind it, plus `cierres.ver` like the whole section -- exactly its tab's visibility in `../../nav-sections.ts#gestionDtSections`. */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function VencimientosLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "cierres.ver") || !can(session, "stock.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
