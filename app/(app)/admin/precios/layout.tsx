/**
 * Layout guard for `/admin/precios/**` (FASE 4 point 4.6). Gated on
 * `precios.reglas.editar` -- plan §7 grants it only to ADM and DT, and
 * there is no dedicated `precios.reglas.ver` in the matrix (same "single
 * permiso doubles as may-enter-section" convention as
 * app/(app)/admin/unidades/layout.tsx).
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function PreciosLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "precios.reglas.editar")) {
    redirect("/");
  }

  return <>{children}</>;
}
