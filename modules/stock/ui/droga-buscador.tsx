"use client";

/**
 * Droga autocomplete for the stock screens, over `buscarDrogasStockAction` (stock.ver). Suggestions show the available
 * stock. It only filters the screen's list (`alBuscar`): Enter, the last row ("Buscar “x” en la lista") or a suggestion
 * (by its name) -- free text (a lote, part of a name) works the same; the droga is opened from the list. Clearing the
 * box removes that search.
 */
import { Search } from "lucide-react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/shared/ui/combobox";
import { hrefConParam } from "@/shared/ui/href-con-param";
import { buscarDrogasStockAction } from "./buscar-drogas-stock-action";

export interface DrogaBuscadorDestino {
  /** Path (and fixed query) to navigate to. */
  href: string;
  /** Query param that receives the value. */
  param: string;
}

export interface DrogaBuscadorProps {
  id: string;
  label: string;
  hideLabel?: boolean;
  placeholder: string;
  /** Where the typed text goes as the list's search. */
  alBuscar: DrogaBuscadorDestino & { texto: string; textoSinBusqueda: string };
  /** The list's current search, shown in the box (clearing it removes the search). */
  busquedaActual?: string;
}

function destino(base: DrogaBuscadorDestino, valor: string): string {
  return hrefConParam(base.href, base.param, valor);
}

export function DrogaBuscador({ id, label, hideLabel, placeholder, alBuscar, busquedaActual }: DrogaBuscadorProps) {
  const router = useRouter();
  const search = useCallback(async (q: string) => {
    const items = await buscarDrogasStockAction(q);
    return items.map((item) => ({ value: item.drogaId, label: item.drogaNombre, description: item.disponible, sinonimo: item.sinonimo }));
  }, []);

  return (
    <Combobox
      id={id}
      label={label}
      hideLabel={hideLabel}
      placeholder={placeholder}
      search={search}
      enterRunsAction
      value={busquedaActual ? { value: "", label: busquedaActual } : null}
      onChange={(option) => {
        if (!option && busquedaActual) router.push(destino(alBuscar, ""), { scroll: false });
      }}
      actionOption={{
        label: (q) => (q ? alBuscar.texto.replace("{q}", q) : alBuscar.textoSinBusqueda),
        onSelect: (q) => router.push(destino(alBuscar, q), { scroll: false }),
        icon: <Search className="size-4 flex-none" aria-hidden />,
      }}
    />
  );
}
