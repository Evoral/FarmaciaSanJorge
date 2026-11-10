/**
 * "Partidas | Existencia inicial" tabs of the partidas list pages (`/partidas`
 * and `/partidas/existencia-inicial`, openspec/changes/planilla-existencia-inicial).
 * Rendered by each list page on purpose, NOT by `partidas/layout.tsx`: that
 * layout also wraps `/partidas/ingresar` and `/partidas/[id]`, which do not
 * show the tabs. "Partidas" is an exact match because its href is a prefix of
 * the Existencia inicial one. The second link is hidden when the relevamiento is
 * closed and the tenant has no existencia inicial partidas (R5).
 */
import { SectionTabs } from "../section-tabs";

export interface PartidasTabsProps {
  mostrarExistenciaInicial: boolean;
}

export function PartidasTabs({ mostrarExistenciaInicial }: PartidasTabsProps) {
  return (
    <SectionTabs
      ariaLabel="Secciones del listado de partidas"
      links={[
        { href: "/partidas", label: "Partidas", exact: true },
        ...(mostrarExistenciaInicial ? [{ href: "/partidas/existencia-inicial", label: "Existencia inicial" }] : []),
      ]}
    />
  );
}
