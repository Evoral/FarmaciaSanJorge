/** Layout guard for `/catalogos/repartidores/**` (docs/specs/envios-repartidores.md). */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function RepartidoresLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "repartidores.gestionar")) {
    redirect("/");
  }

  return <>{children}</>;
}
