"use client";

/**
 * Filter of the "Listas importadas" list: proveedor as an AUTOCOMPLETE (the project rule for any proveedor
 * filter) inside an auto-applying `FilterForm` -- picking or clearing an option changes the URL at once
 * (`proveedor`: an opaque uuid, no personal data) and drops `page`. Same source as the "Vigentes" filter
 * (`buscarProveedoresCatalogoAction`, which also lists the ones "(baja)": their lists stay consultable).
 *
 * The page re-keys this component with the filter in force, so a link that changes the URL from outside
 * ("Limpiar") never leaves a stale selection in the box.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";
import { FilterForm } from "@/shared/ui/filter-form";
import { buscarProveedoresCatalogoAction } from "@/modules/proveedores/ui/buscar-proveedores-catalogo-action";

export interface ListasFiltrosProps {
  /** The proveedor filter in force, when it resolves to one of the tenant's proveedores. */
  proveedor: { id: string; razonSocial: string } | null;
  /** The filter is in the URL: shows "Limpiar". */
  hayFiltros: boolean;
}

export function ListasFiltros({ proveedor, hayFiltros }: ListasFiltrosProps) {
  const [proveedorOpcion, setProveedorOpcion] = useState<ComboboxOption | null>(proveedor ? { value: proveedor.id, label: proveedor.razonSocial } : null);

  const buscarProveedores = useCallback(async (consulta: string): Promise<readonly ComboboxOption[]> => {
    const proveedores = await buscarProveedoresCatalogoAction(consulta);
    return proveedores.map((p) => ({ value: p.id, label: p.label, description: p.description }));
  }, []);

  return (
    <div className="filter-bar items-end">
      <FilterForm className="flex min-w-0 flex-1 flex-wrap items-end gap-3" aria-label="Filtros de listas importadas" hasActiveFilters={false}>
        <div className="min-w-0 flex-1 md:w-72 md:flex-none">
          <Combobox
            id="filtro-proveedor-listas"
            label="Proveedor"
            hideLabel
            placeholder="Filtrar por proveedor"
            name="proveedor"
            search={buscarProveedores}
            value={proveedorOpcion}
            onChange={setProveedorOpcion}
          />
        </div>
      </FilterForm>
      {hayFiltros ? (
        <Link href="/costos-proveedor/listas" scroll={false} className="btn btn-ghost btn-sm">
          Limpiar
        </Link>
      ) : null}
    </div>
  );
}
