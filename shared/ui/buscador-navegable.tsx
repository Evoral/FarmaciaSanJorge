"use client";

/**
 * Generic list-search autocomplete for catalog-like lists: typing shows matching records (from a read-only Server
 * Action the page passes in), picking one opens its detail, and the last row applies the typed text as the list's
 * own search param instead. Clearing the box removes that search. One component for drogas, médicos, unidades...: the
 * page decides the source, the detail URL and the list URL.
 */
import { ListFilter } from "lucide-react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "./combobox";
import { hrefConParam } from "./href-con-param";

export interface SugerenciaNavegable {
  id: string;
  label: string;
  /** Short trailing detail (matrícula, símbolo, unidad...). */
  description?: string;
}

export interface BuscadorNavegableProps {
  id: string;
  label: string;
  placeholder: string;
  /** Read-only Server Action: the term in, at most a handful of suggestions out. */
  buscar: (busqueda: string) => Promise<SugerenciaNavegable[]>;
  /** Detail URL with `{id}` (e.g. "/catalogos/drogas/{id}"). */
  detalleHref: string;
  /** The list's URL without the search param (the other filters kept). */
  listaHref: string;
  /** Query param of the list's search. Defaults to "q". */
  param?: string;
  /** The list's current search, shown in the box. */
  busquedaActual?: string;
  /** Last row text when nothing is typed, e.g. "Ver todas las drogas". */
  textoVerTodos: string;
}

export function BuscadorNavegable({ id, label, placeholder, buscar, detalleHref, listaHref, param = "q", busquedaActual, textoVerTodos }: BuscadorNavegableProps) {
  const router = useRouter();

  const search = useCallback(
    async (q: string) => {
      const items = await buscar(q);
      return items.map((item) => ({ value: item.id, label: item.label, description: item.description }));
    },
    [buscar],
  );

  return (
    <Combobox
      id={id}
      label={label}
      hideLabel
      placeholder={placeholder}
      search={search}
      value={busquedaActual ? { value: "", label: busquedaActual } : null}
      onChange={(option) => {
        if (!option) {
          if (busquedaActual) router.push(hrefConParam(listaHref, param, ""), { scroll: false });
          return;
        }
        router.push(detalleHref.replace("{id}", encodeURIComponent(option.value)));
      }}
      actionOption={{
        label: (q) => (q ? `Filtrar la lista por “${q}”` : textoVerTodos),
        onSelect: (q) => router.push(hrefConParam(listaHref, param, q), { scroll: false }),
        icon: <ListFilter className="size-4 flex-none" aria-hidden />,
      }}
    />
  );
}
