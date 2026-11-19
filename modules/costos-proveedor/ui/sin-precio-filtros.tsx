"use client";

/**
 * Filters of the "Sin precio" list: text search (nombre or sinónimo) and
 * tipo (todos, droga, excipiente, material) inside an auto-applying `FilterForm`.
 *
 * A search input debounces typing and never opens a record directly.
 * Responsive with container queries (@container).
 */
import Link from "next/link";
import { FilterForm } from "@/shared/ui/filter-form";
import type { TipoItemSinCosto } from "../application/listar-sin-costo";

export interface SinPrecioFiltrosProps {
  busqueda?: string;
  tipo: TipoItemSinCosto;
  hayFiltros: boolean;
}

export function SinPrecioFiltros({ busqueda, tipo, hayFiltros }: SinPrecioFiltrosProps) {
  return (
    <div className="filter-bar items-end @container">
      <FilterForm className="flex min-w-0 flex-1 flex-wrap items-end gap-3" aria-label="Filtros de ítems sin precio" hasActiveFilters={false}>
        <div className="min-w-0 flex-1 @sm:min-w-64">
          <label htmlFor="filtro-q" className="sr-only">
            Buscar por nombre
          </label>
          <input
            id="filtro-q"
            name="q"
            type="search"
            defaultValue={busqueda ?? ""}
            placeholder="Buscar por nombre o sinónimo..."
            className="input w-full"
          />
        </div>
        <div className="w-full @xs:w-48">
          <label htmlFor="filtro-tipo" className="sr-only">
            Tipo
          </label>
          <select id="filtro-tipo" name="tipo" defaultValue={tipo} className="input w-full">
            <option value="todos">Todos los tipos</option>
            <option value="droga">Drogas</option>
            <option value="excipiente">Excipientes</option>
            <option value="material">Materiales</option>
          </select>
        </div>
      </FilterForm>
      {hayFiltros ? (
        <Link href="/costos-proveedor/sin-precio" scroll={false} className="btn btn-ghost btn-sm">
          Limpiar
        </Link>
      ) : null}
    </div>
  );
}
