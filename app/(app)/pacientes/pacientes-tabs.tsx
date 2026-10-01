/**
 * "Todos | Recurrentes" tabs of the paciente LIST pages (`/pacientes` and
 * `/pacientes/recurrentes`). Rendered by each list page on purpose, NOT by
 * `pacientes/layout.tsx`: that layout also wraps `/pacientes/[id]/**`, which has
 * its own "Datos | Trayectoria" tabs. "Todos" is an exact match because its
 * href is a prefix of the Recurrentes one. The hrefs carry nothing identifying
 * (DP-24).
 */
import { SectionTabs } from "../section-tabs";

export function PacientesTabs() {
  return (
    <SectionTabs
      ariaLabel="Secciones del listado de pacientes"
      links={[
        { href: "/pacientes", label: "Todos", exact: true },
        { href: "/pacientes/recurrentes", label: "Recurrentes" },
      ]}
    />
  );
}
