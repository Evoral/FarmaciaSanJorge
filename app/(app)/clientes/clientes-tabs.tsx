/**
 * "Todos | Seguimiento" tabs of the paciente LIST pages (`/clientes` and
 * `/clientes/seguimiento`). Rendered by each list page on purpose, NOT by
 * `pacientes/layout.tsx`: that layout also wraps `/clientes/[id]/**`, which has
 * its own "Datos | Historial" tabs. "Todos" is an exact match because its
 * href is a prefix of the Seguimiento one. The hrefs carry nothing identifying
 * (DP-24).
 */
import { SectionTabs } from "../section-tabs";

export function ClientesTabs() {
  return (
    <SectionTabs
      ariaLabel="Secciones del listado de clientes"
      links={[
        { href: "/clientes", label: "Todos", exact: true },
        { href: "/clientes/seguimiento", label: "Seguimiento" },
      ]}
    />
  );
}

/**
 * "Datos | Historial" tabs of ONE paciente (`/clientes/[id]/**`). Rendered by each page right under its header
 * (the header needs the paciente's data, which the layout does not load). "Datos" is an exact match because its href
 * is a prefix of the Historial one. `id` is an opaque uuid (DP-24).
 */
export function ClienteTabs({ id }: { id: string }) {
  return (
    <SectionTabs
      ariaLabel="Secciones del cliente"
      links={[
        { href: `/clientes/${id}`, label: "Datos", exact: true },
        { href: `/clientes/${id}/historial`, label: "Historial" },
      ]}
    />
  );
}
