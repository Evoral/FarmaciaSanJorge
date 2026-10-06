/**
 * "Todos | Seguimiento" tabs of the paciente LIST pages (`/pacientes` and
 * `/pacientes/seguimiento`). Rendered by each list page on purpose, NOT by
 * `pacientes/layout.tsx`: that layout also wraps `/pacientes/[id]/**`, which has
 * its own "Datos | Historial" tabs. "Todos" is an exact match because its
 * href is a prefix of the Seguimiento one. The hrefs carry nothing identifying
 * (DP-24).
 */
import { SectionTabs } from "../section-tabs";

export function PacientesTabs() {
  return (
    <SectionTabs
      ariaLabel="Secciones del listado de pacientes"
      links={[
        { href: "/pacientes", label: "Todos", exact: true },
        { href: "/pacientes/seguimiento", label: "Seguimiento" },
      ]}
    />
  );
}

/**
 * "Datos | Historial" tabs of ONE paciente (`/pacientes/[id]/**`). Rendered by each page right under its header
 * (the header needs the paciente's data, which the layout does not load). "Datos" is an exact match because its href
 * is a prefix of the Historial one. `id` is an opaque uuid (DP-24).
 */
export function PacienteTabs({ id }: { id: string }) {
  return (
    <SectionTabs
      ariaLabel="Secciones del paciente"
      links={[
        { href: `/pacientes/${id}`, label: "Datos", exact: true },
        { href: `/pacientes/${id}/historial`, label: "Historial" },
      ]}
    />
  );
}
