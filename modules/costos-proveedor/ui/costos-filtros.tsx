"use client";

/**
 * Filters of the "Vigentes" list: proveedor and droga as AUTOCOMPLETES (the project
 * rule for any proveedor / droga filter), inside an auto-applying `FilterForm` -- picking
 * or clearing an option changes the URL at once (`droga`, `proveedor`: opaque uuids, no
 * personal data), and a change drops `page`.
 *
 * The suggestions come from the existing catalog searches (`buscarDrogasCatalogoAction`,
 * `buscarProveedoresCatalogoAction`: thin wrappers over `listDrogas` / `listProveedores`,
 * which include the ones "(baja)": a costo of a baja stays listed, R12).
 *
 * The page re-keys this component with the filters in force, so a link that changes the
 * URL from outside ("Limpiar") never leaves a stale selection in the boxes.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";
import { FilterForm } from "@/shared/ui/filter-form";
import { buscarDrogasCatalogoAction } from "@/modules/drogas/ui/buscar-drogas-catalogo-action";
import { buscarProveedoresCatalogoAction } from "@/modules/proveedores/ui/buscar-proveedores-catalogo-action";

export interface CostosFiltrosProps {
  /** The droga filter in force, when it resolves to one of the tenant's drogas. */
  droga: { id: string; nombre: string } | null;
  proveedor: { id: string; razonSocial: string } | null;
  /** Any filter is in the URL: shows "Limpiar". */
  hayFiltros: boolean;
}

export function CostosFiltros({ droga, proveedor, hayFiltros }: CostosFiltrosProps) {
  const [drogaOpcion, setDrogaOpcion] = useState<ComboboxOption | null>(droga ? { value: droga.id, label: droga.nombre } : null);
  const [proveedorOpcion, setProveedorOpcion] = useState<ComboboxOption | null>(proveedor ? { value: proveedor.id, label: proveedor.razonSocial } : null);

  const buscarDrogas = useCallback(async (consulta: string): Promise<readonly ComboboxOption[]> => {
    const drogas = await buscarDrogasCatalogoAction(consulta);
    return drogas.map((d) => ({ value: d.id, label: d.label, description: d.description, sinonimo: d.sinonimo }));
  }, []);

  const buscarProveedores = useCallback(async (consulta: string): Promise<readonly ComboboxOption[]> => {
    const proveedores = await buscarProveedoresCatalogoAction(consulta);
    return proveedores.map((p) => ({ value: p.id, label: p.label, description: p.description }));
  }, []);

  return (
    <div className="filter-bar items-end">
      <FilterForm className="flex min-w-0 flex-1 flex-wrap items-end gap-3" aria-label="Filtros de costos de proveedores" hasActiveFilters={false}>
        <div className="min-w-0 flex-1 md:w-72 md:flex-none">
          <Combobox id="filtro-droga" label="Droga" hideLabel placeholder="Filtrar por droga" name="droga" search={buscarDrogas} value={drogaOpcion} onChange={setDrogaOpcion} />
        </div>
        <div className="min-w-0 flex-1 md:w-72 md:flex-none">
          <Combobox
            id="filtro-proveedor"
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
        <Link href="/costos-proveedor" scroll={false} className="btn btn-ghost btn-sm">
          Limpiar
        </Link>
      ) : null}
    </div>
  );
}
