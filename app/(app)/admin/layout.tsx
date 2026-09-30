/**
 * Outer layout guard for `/admin/**` (M03, plan §7: "guardas de layout
 * server-side por permiso"). `/admin` now holds two sidebar entries of the
 * "Administración" group, each with its own layout, tab nav and guard:
 *   - `/admin/accesos/**` ("Usuarios y accesos": usuarios, roles,
 *     directores técnicos) -- see `./accesos/layout.tsx`;
 *   - `/admin/configuracion/**` ("Configuración": farmacia, parámetros,
 *     reglas de precio) -- see `./configuracion/layout.tsx`.
 * Unidades de medida moved out to `/catalogos/unidades`.
 *
 * Next.js nests layouts -- every page under `/admin/**` passes through THIS
 * outer guard first, so it admits the UNION of both groups' sections, or a
 * session that reaches only one group (e.g. a DIRECTOR_TECNICO, whose only
 * `/admin` section is Configuración › Reglas de precio via
 * `precios.reglas.editar`) would be redirected here before ever reaching
 * its own more specific, correctly-scoped guard. Both lists come from `../nav-sections.ts`, the
 * same source the nested guards, tab navs and sidebar hrefs use.
 *
 * This is UX, not the security boundary: the real, per-action boundary is
 * still each use case's own `authorize(permiso)` (see
 * modules/auth/domain/authorize.ts's module doc comment on `can()` vs
 * `authorize()`).
 */
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { accesosSections, configuracionSections } from "../nav-sections";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (accesosSections(session).length === 0 && configuracionSections(session).length === 0) {
    redirect("/");
  }

  return <div className="page">{children}</div>;
}
