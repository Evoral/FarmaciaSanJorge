/**
 * "Datos | Trayectoria" tabs of ONE proveedor (`/proveedores/[id]/**`). Rendered by each page right under its header
 * (the header needs the proveedor's data, which the layout does not load). "Datos" is an exact match because its href
 * is a prefix of the Trayectoria one.
 */
import { SectionTabs } from "../section-tabs";

export function ProveedorTabs({ id }: { id: string }) {
  return (
    <SectionTabs
      ariaLabel="Secciones del proveedor"
      links={[
        { href: `/proveedores/${id}`, label: "Datos", exact: true },
        { href: `/proveedores/${id}/trayectoria`, label: "Trayectoria" },
      ]}
    />
  );
}
