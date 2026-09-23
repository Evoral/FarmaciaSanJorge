/**
 * Layout guard for `/auditoria` (M03, FASE 3 point 3.11). Mirrors
 * `app/(app)/admin/layout.tsx`'s per-permiso guard pattern: only a session
 * that can see `auditoria.ver` reaches this route at all. This is UX, not
 * the real security boundary -- `listRegistroAuditoriaQuery` (and every
 * other use case here) re-checks `authorize("auditoria.ver")` on every
 * call regardless of this layout (see
 * modules/auth/domain/authorize.ts's `can()` vs `authorize()` doc
 * comment).
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export default async function AuditoriaLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!can(session, "auditoria.ver")) {
    redirect("/");
  }

  return <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>;
}
