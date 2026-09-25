/**
 * Layout guard for `/archivo/**` (FASE 12, M15). Gated on
 * `archivo.lotes.gestionar` ONLY -- every query under `/archivo/**`
 * (`listLotesQuery`/`getLoteDetalleQuery` in `modules/archivo/application/list-lotes.ts`)
 * requires that exact permiso, so a session holding ONLY
 * `archivo.destruccion.gestionar` would otherwise pass this layout guard
 * and then hit a hard `AuthorizationError` on every page underneath --
 * this used to admit either permiso, which was inconsistent with the
 * queries it guards. `archivo.destruccion.gestionar` alone still gates the
 * destrucción action forms themselves (`app/(app)/archivo/[id]/page.tsx`'s
 * `puedeDestruccion`), it just never grants access to `/archivo/**` on its
 * own -- both permisos are DIRECTOR_TECNICO-only today (migration 0002)
 * regardless.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function ArchivoLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "archivo.lotes.gestionar")) {
    redirect("/");
  }

  return <>{children}</>;
}
