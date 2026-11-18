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
 * R39 adds the fecha del precio range (`desde`, `hasta`), the origen (`manual` / `lista`) and
 * "Sin actualizar hace más de un año" (`desactualizados=1`), all plain GET fields of the same form.
 * They live in a `FilterDrawer`: inline on wide screens, a "Filtros" sheet on phones (two date
 * inputs side by side don't fit 375px).
 *
 * The page re-keys this component with the filters in force, so a link that changes the
 * URL from outside ("Limpiar") never leaves a stale selection in the boxes.
 */
import { useCallback, useState } from "react";
import Link from "next/link";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";
import { DateRangeField } from "@/shared/ui/date-range-field";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { FilterForm } from "@/shared/ui/filter-form";
import type { OrigenCostoFiltro } from "../application/listar-costos-vigentes";
import { buscarDrogasCatalogoAction } from "@/modules/drogas/ui/buscar-drogas-catalogo-action";
import { buscarProveedoresCatalogoAction } from "@/modules/proveedores/ui/buscar-proveedores-catalogo-action";

export interface CostosFiltrosProps {
  /** The droga filter in force, when it resolves to one of the tenant's drogas. */
  droga: { id: string; nombre: string } | null;
  proveedor: { id: string; razonSocial: string } | null;
  /** `YYYY-MM-DD` or "" (R39). */
  fechaDesde: string;
  fechaHasta: string;
  origen: OrigenCostoFiltro;
  soloDesactualizados: boolean;
  /** Any filter is in the URL: shows "Limpiar". */
  hayFiltros: boolean;
}

export function CostosFiltros({ droga, proveedor, fechaDesde, fechaHasta, origen, soloDesactualizados, hayFiltros }: CostosFiltrosProps) {
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
    <div className="filter-bar items-end @container">
      <FilterForm className="flex min-w-0 flex-1 flex-wrap items-end gap-3" aria-label="Filtros de costos de proveedores" hasActiveFilters={false}>
        <div className="min-w-0 flex-[1_1_14rem] @3xl:w-72 @3xl:flex-none">
          <Combobox id="filtro-droga" label="Insumo" hideLabel placeholder="Filtrar por insumo" name="droga" search={buscarDrogas} value={drogaOpcion} onChange={setDrogaOpcion} />
        </div>
        <div className="min-w-0 flex-[1_1_14rem] @3xl:w-72 @3xl:flex-none">
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
        <FilterDrawer activeCount={(fechaDesde || fechaHasta ? 1 : 0) + (origen !== "todos" ? 1 : 0) + (soloDesactualizados ? 1 : 0)}>
          <DateRangeField id="filtro-fecha-precio" label="Fecha del precio" desdeName="desde" hastaName="hasta" desdeDefault={fechaDesde} hastaDefault={fechaHasta} />
          <div className="field @lg:w-44">
            <label htmlFor="filtro-origen" className="field-label">
              Origen
            </label>
            <select id="filtro-origen" name="origen" defaultValue={origen} className="input w-full">
              <option value="todos">Todos</option>
              <option value="manual">Carga manual</option>
              <option value="lista">Lista importada</option>
            </select>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" role="switch" name="desactualizados" value="1" defaultChecked={soloDesactualizados} />
            Sin actualizar hace más de un año
          </label>
        </FilterDrawer>
      </FilterForm>
      {hayFiltros ? (
        <Link href="/costos-proveedor" scroll={false} className="btn btn-ghost btn-sm">
          Limpiar
        </Link>
      ) : null}
    </div>
  );
}
