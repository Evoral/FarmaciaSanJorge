/**
 * "Datos | Historial" tabs of ONE droga (`/catalogos/drogas/[id]/**`). Rendered by each page right under its
 * header. "Datos" is an exact match because its href is a prefix of the Historial one. The Historial tab only
 * exists for sessions that may see it (`puedeVerHistorialDroga`: `recetas.crear`, the permiso the page itself checks);
 * without it there is a single section, so no tab bar is rendered at all.
 */
import { SectionTabs } from "../../section-tabs";

export function DrogaTabs({ id, conHistorial }: { id: string; conHistorial: boolean }) {
  if (!conHistorial) return null;
  return (
    <SectionTabs
      ariaLabel="Secciones de la droga"
      links={[
        { href: `/catalogos/drogas/${id}`, label: "Datos", exact: true },
        { href: `/catalogos/drogas/${id}/historial`, label: "Historial" },
      ]}
    />
  );
}
