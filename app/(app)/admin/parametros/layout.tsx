/**
 * Layout guard for `/admin/parametros/**` (FASE 3 point 3.10b). Same
 * pattern as app/(app)/admin/farmacia/layout.tsx: allows anyone with
 * `config.ver` to reach the section; `config.editar` is enforced per-action
 * by `editarParametroCommand` and, on the UI side, by the form only
 * rendering enabled inputs for a session that can edit (see
 * app/(app)/admin/parametros/page.tsx).
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function ParametrosLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "config.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
