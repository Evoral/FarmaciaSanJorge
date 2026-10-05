"use client";

/**
 * Droga picker of the "Comparador de costos": an AUTOCOMPLETE over the drogas with partidas that the use case already
 * returned (vigentes first, then the ones "(de baja)"; labels built on the server with `etiquetaOpcionDroga`).
 * Picking one sets `droga` and keeps `unidad`/`periodo` as they are in the URL (same as the old select submitting the
 * whole form: a unit that does not fit the new droga falls back to the default). Clearing it goes back to the bare
 * comparador, keeping only the período.
 */
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Combobox, filtrarOpciones } from "@/shared/ui/combobox";
import type { ComboboxOption } from "@/shared/ui/combobox";
import { hrefConParam } from "@/shared/ui/href-con-param";

export interface ComparadorDrogaBuscadorProps {
  opciones: readonly ComboboxOption[];
  /** The selected droga's option, when one is in force. */
  seleccion: ComboboxOption | null;
  /** `/comparador-costos` with its current params. */
  href: string;
}

export function ComparadorDrogaBuscador({ opciones, seleccion, href }: ComparadorDrogaBuscadorProps) {
  const router = useRouter();
  const search = useMemo(() => filtrarOpciones(opciones, 50), [opciones]);

  return (
    <Combobox
      id="comparador-droga"
      label="Droga"
      placeholder="Buscar la droga a comparar"
      search={search}
      value={seleccion}
      onChange={(option) => {
        const destino = option ? hrefConParam(href, "droga", option.value) : hrefConParam(hrefConParam(href, "droga", ""), "unidad", "");
        router.push(destino, { scroll: false });
      }}
    />
  );
}
