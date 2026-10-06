/**
 * Layout guard for `/admin/configuracion/etiquetas/**` (tamaños de etiqueta).
 * Same pattern as app/(app)/admin/configuracion/parametros/layout.tsx: anyone
 * with `config.ver` (ADMINISTRADOR) reaches the section; `config.editar` is
 * enforced per-action by every command of modules/etiqueta-tamanos and, on the
 * UI side, by the forms only rendering enabled inputs for a session that can
 * edit.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function EtiquetasLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "config.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
