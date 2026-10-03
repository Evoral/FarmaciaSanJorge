"use client";

/**
 * Droga autocomplete for the stock screens, over `buscarDrogasStockAction` (stock.ver). Suggestions show the available
 * stock. What a pick does is the screen's call, expressed as a URL to navigate to:
 * - `/stock`: open the droga's partidas;
 * - `/stock/ajustes`: filter the list by that droga;
 * - "Registrar ajuste": go to step 2 with that droga.
 * The last row ("Buscar “x” en la lista") applies the typed text as the list's own search instead, so free text (a lote,
 * part of a name) still works; clearing the box removes that search.
 */
import { Search } from "lucide-react";
import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/shared/ui/combobox";
import { hrefConParam } from "@/shared/ui/href-con-param";
import { buscarDrogasStockAction, type DrogaStockSugerencia } from "./buscar-drogas-stock-action";

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
  /** Where picking a droga goes; `valor` picks which of its fields fills `param`. */
  alElegir: DrogaBuscadorDestino & { valor: "id" | "nombre" };
  /** Where the typed text goes as the list's search (omit to offer only picking). */
  alBuscar?: DrogaBuscadorDestino & { texto: string; textoSinBusqueda: string };
  /** The list's current search, shown in the box (clearing it removes the search). */
  busquedaActual?: string;
}

function destino(base: DrogaBuscadorDestino, valor: string): string {
  return hrefConParam(base.href, base.param, valor);
}

export function DrogaBuscador({ id, label, hideLabel, placeholder, alElegir, alBuscar, busquedaActual }: DrogaBuscadorProps) {
  const router = useRouter();
  // The last suggestions, to recover the picked droga's name.
  const sugerencias = useRef(new Map<string, DrogaStockSugerencia>());

  const search = useCallback(async (q: string) => {
    const items = await buscarDrogasStockAction(q);
    sugerencias.current = new Map(items.map((item) => [item.drogaId, item]));
    return items.map((item) => ({ value: item.drogaId, label: item.drogaNombre, description: item.disponible }));
  }, []);

  return (
    <Combobox
      id={id}
      label={label}
      hideLabel={hideLabel}
      placeholder={placeholder}
      search={search}
      value={busquedaActual ? { value: "", label: busquedaActual } : null}
      onChange={(option) => {
        if (!option) {
          if (alBuscar && busquedaActual) router.push(destino(alBuscar, ""), { scroll: false });
          return;
        }
        const droga = sugerencias.current.get(option.value);
        if (!droga) return;
        router.push(destino(alElegir, alElegir.valor === "id" ? droga.drogaId : droga.drogaNombre), { scroll: false });
      }}
      actionOption={
        alBuscar
          ? {
              label: (q) => (q ? alBuscar.texto.replace("{q}", q) : alBuscar.textoSinBusqueda),
              onSelect: (q) => router.push(destino(alBuscar, q), { scroll: false }),
              icon: <Search className="size-4 flex-none" aria-hidden />,
            }
          : undefined
      }
    />
  );
}
