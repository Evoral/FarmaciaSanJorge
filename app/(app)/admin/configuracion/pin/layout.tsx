/**
 * Layout guard for `/admin/configuracion/pin/**` (docs/specs/cuentas-de-sector.md).
 * Same pattern as ../parametros/layout.tsx: `config.ver` reaches the section;
 * `config.editar` is enforced per-action by `configurarAccionesConPinCommand`
 * and, on the UI side, by the form rendering read-only without it.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function PinPorAccionLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "config.ver")) {
    redirect("/");
  }

  return <>{children}</>;
}
