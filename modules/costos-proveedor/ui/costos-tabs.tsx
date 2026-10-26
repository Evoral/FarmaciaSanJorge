/**
 * Tabs of the "Costos de proveedores" section (openspec/specs/costos-proveedor/spec.md, "Interface"):
 * Vigentes, Importar lista and Listas importadas. Each page renders them under its header with its own
 * `activa`, because a layout can not tell which page is current. "Importar lista" is only offered to
 * whoever can import (`costos.proveedor.gestionar`, R36); the page itself checks it again. Server Component.
 */
import { TabNav } from "@/shared/ui/tab-nav";

export type TabCostos = "vigentes" | "importar" | "listas";

export function CostosTabs({ activa, puedeGestionar }: { activa: TabCostos; puedeGestionar: boolean }) {
  return (
    <TabNav
      label="Secciones de costos de proveedores"
      items={[
        { key: "vigentes", label: "Vigentes", href: "/costos-proveedor", active: activa === "vigentes" },
        ...(puedeGestionar ? [{ key: "importar", label: "Importar lista", href: "/costos-proveedor/importar", active: activa === "importar" }] : []),
        { key: "listas", label: "Listas importadas", href: "/costos-proveedor/listas", active: activa === "listas" },
      ]}
    />
  );
}
