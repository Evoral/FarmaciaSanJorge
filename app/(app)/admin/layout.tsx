/**
 * Layout guard for `/admin/**` (M03, plan §7: "guardas de layout
 * server-side por permiso"). Only a session that can see AT LEAST ONE of
 * the admin screens reaches any `/admin/*` page -- the real, per-action
 * boundary is still each use case's own `authorize(permiso)` (this is UX,
 * not the security boundary: see modules/auth/domain/authorize.ts's
 * module doc comment on `can()` vs `authorize()`).
 *
 * FASE 3 points 3.9/3.10: `/admin/farmacia` and `/admin/parametros` each
 * have their OWN nested layout gated on `config.ver` (granted to ALL FIVE
 * roles, migration 0002's seed), and `/admin/directores-tecnicos` has its
 * own nested layout gated on `dt.designar`/`dt.cesar`. Next.js nests
 * layouts -- every page under `/admin/**` still passes through THIS outer
 * guard first, so it must also allow those permisos through, or a session
 * that holds only `config.ver` (e.g. FARMACEUTICO) would be redirected
 * here before ever reaching its own more specific, correctly-scoped guard.
 *
 * The section nav (`./admin-nav.tsx`) reuses these SAME five `can()` checks
 * -- one per section, matching exactly what that section's own nested
 * layout guards on -- so a link is never shown for a section the session
 * cannot actually reach.
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  const puedeUsuarios = can(session, "usuarios.listar");
  const puedeRoles = can(session, "roles.ver");
  const puedeDirectoresTecnicos = can(session, "dt.designar") || can(session, "dt.cesar");
  const puedeFarmacia = can(session, "config.ver");
  const puedeParametros = can(session, "config.ver");
  const puedeUnidades = can(session, "unidades.editar");
  const puedePrecios = can(session, "precios.reglas.editar");

  const puedeEntrar = puedeUsuarios || puedeRoles || puedeFarmacia || puedeParametros || puedeDirectoresTecnicos || puedeUnidades || puedePrecios;

  if (!puedeEntrar) {
    redirect("/");
  }

  return (
    <div className="page">
      <AdminNav
        puedeUsuarios={puedeUsuarios}
        puedeRoles={puedeRoles}
        puedeDirectoresTecnicos={puedeDirectoresTecnicos}
        puedeFarmacia={puedeFarmacia}
        puedeParametros={puedeParametros}
        puedeUnidades={puedeUnidades}
        puedePrecios={puedePrecios}
      />
      {children}
    </div>
  );
}
