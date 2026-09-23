/**
 * Layout guard for `/admin/directores-tecnicos/**` (M04, FASE 3 point 3.9).
 * Gated on EXACTLY `dt.designar` (review finding M2) -- that is also what
 * every read this route's page performs actually requires
 * (`listDesignaciones`/`dtVigenteHoy`/`listUsuariosElegiblesDt`, all
 * `defineQuery({ permiso: "dt.designar" })`). Gating on `dt.designar OR
 * dt.cesar` let a `dt.cesar`-only session (there is no such role in
 * migration 0002's seed today, but nothing stops a future one) pass this
 * layout and then hit an unhandled `AuthorizationError` from those reads --
 * an unhandled 500 instead of a clean redirect. The page itself already
 * shows the cese action only when `can(session, "dt.cesar")` (see
 * `./page.tsx`'s `puedeCesar`), so a cese-only session losing this route
 * entirely is a real change: the plan's permission matrix does not define
 * a separate `dt.ver`, and adding one would need its own migration
 * (task instruction: not needed here). This is UX, not the security
 * boundary either way -- the real, per-action boundary is still each use
 * case's own `authorize(permiso)`; see `modules/auth/domain/authorize.ts`'s
 * module doc comment on `can()` vs `authorize()`.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function DirectoresTecnicosLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "dt.designar")) {
    redirect("/");
  }

  return <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>;
}
