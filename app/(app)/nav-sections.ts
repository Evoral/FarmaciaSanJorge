/**
 * Single source of truth for the tabbed sections behind the sidebar's
 * "Catálogos", "Usuarios y accesos" and "Configuración" entries. Each
 * function returns the sections the session can actually reach, already
 * filtered and in priority order, as plain `{ href, label }` data.
 *
 * Every visibility check here is EXACTLY the permiso that section's OWN
 * nested layout guards on (e.g. `admin/accesos/directores-tecnicos/
 * layout.tsx` gates on `dt.designar` only -- see that file's review
 * finding M2 -- so its tab does too). That one rule is what lets the same
 * list drive four things without drifting apart:
 *   - the section's outer layout guard (`links.length > 0`),
 *   - its tab nav (`./section-tabs.tsx`),
 *   - its index route's redirect (`firstSectionHref`), and
 *   - the sidebar entry's href (`app/(app)/layout.tsx`).
 * A link is therefore never shown -- and a redirect never targets -- a
 * section whose own guard would just bounce the session back to `/`.
 *
 * This is UX, not the security boundary: the real, per-action boundary is
 * still each use case's own `authorize(permiso)` (see
 * modules/auth/domain/authorize.ts's module doc comment on `can()` vs
 * `authorize()`).
 */
import type { AuthenticatedSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";

export interface SectionLink {
  href: string;
  label: string;
  /** Active ONLY on this exact path, not on its sub-paths (a tab whose href is a prefix of a sibling tab's, e.g. `/pacientes/[id]` vs `/pacientes/[id]/historial`). */
  exact?: boolean;
}

function visible(entries: ReadonlyArray<SectionLink & { visible: boolean }>): SectionLink[] {
  return entries.filter((entry) => entry.visible).map(({ href, label, exact }) => (exact === undefined ? { href, label } : { href, label, exact }));
}

/**
 * `/catalogos/**` (FASE 4 points 4.1, 4.2, 4.4). Unidades de medida (FASE 4
 * point 4.1, formerly under `/admin`) goes last so the existing landing
 * section for every role is unchanged: there is no dedicated
 * `unidades.ver`, `unidades.editar` doubles as "may enter the section"
 * (see `catalogos/unidades/layout.tsx`). Proveedores (point 4.3) and
 * Pacientes (point 4.5) are NOT tabs here anymore: each is its own sidebar
 * entry under "Gestión" (`/proveedores` gated on `proveedores.gestionar`,
 * `/pacientes` gated on `pacientes.gestionar`).
 */
export function catalogosSections(session: AuthenticatedSession): SectionLink[] {
  return visible([
    { href: "/catalogos/drogas", label: "Drogas", visible: can(session, "drogas.editar") },
    { href: "/catalogos/medicos", label: "Médicos", visible: can(session, "medicos.gestionar") },
    { href: "/catalogos/unidades", label: "Unidades de medida", visible: can(session, "unidades.editar") },
  ]);
}

/** `/admin/accesos/**` -- "Usuarios y accesos" (M03/M04, FASE 3 points 3.1-3.9). */
export function accesosSections(session: AuthenticatedSession): SectionLink[] {
  return visible([
    { href: "/admin/accesos/usuarios", label: "Usuarios", visible: can(session, "usuarios.listar") },
    { href: "/admin/accesos/roles", label: "Roles", visible: can(session, "roles.ver") },
    { href: "/admin/accesos/directores-tecnicos", label: "Directores técnicos", visible: can(session, "dt.designar") },
  ]);
}

/**
 * `/admin/configuracion/**` -- "Configuración" (FASE 3 point 3.10, FASE 4
 * point 4.6). ADMINISTRADOR-only since migration 0046 (user decision
 * 2026-09-28): `config.ver` -- Farmacia/Parámetros -- is held by ADM alone,
 * and the one deliberate exception is `precios.reglas.editar` (ADM/DT), so
 * a DIRECTOR_TECNICO sees this area with only the "Reglas de precio" tab.
 * Every other role gets an empty list here: no sidebar entry, and the
 * section/`/admin` guards redirect it to `/`.
 */
export function configuracionSections(session: AuthenticatedSession): SectionLink[] {
  const puedeConfig = can(session, "config.ver");
  return visible([
    { href: "/admin/configuracion/farmacia", label: "Farmacia", visible: puedeConfig },
    { href: "/admin/configuracion/parametros", label: "Parámetros", visible: puedeConfig },
    { href: "/admin/configuracion/precios", label: "Reglas de precio", visible: can(session, "precios.reglas.editar") },
  ]);
}

/** The first reachable section's href, or `null` when the session can reach none. */
export function firstSectionHref(links: readonly SectionLink[]): string | null {
  return links[0]?.href ?? null;
}
