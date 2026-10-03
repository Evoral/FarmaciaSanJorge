"use client";

/**
 * Droga autocomplete for `/libro/contralor`, over `buscarDrogasContralorAction` (libro.ver): only drogas that appear
 * in the contralor libros. Picking one filters the list by it (`drogaId`); clearing the box removes that filter.
 */
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/shared/ui/combobox";
import { hrefConParam } from "@/shared/ui/href-con-param";
import { buscarDrogasContralorAction } from "./buscar-drogas-contralor-action";

export interface DrogaContralorBuscadorProps {
  /** The list's URL without `drogaId` (the other filters kept). */
  listaHref: string;
  /** The droga currently filtered by, shown in the box. */
  drogaActual?: { id: string; nombre: string };
}

export function DrogaContralorBuscador({ listaHref, drogaActual }: DrogaContralorBuscadorProps) {
  const router = useRouter();

  const search = useCallback(async (q: string) => {
    const drogas = await buscarDrogasContralorAction(q);
    return drogas.map((d) => ({ value: d.drogaId, label: d.drogaDescripcion }));
  }, []);

  return (
    <Combobox
      id="droga-contralor"
      label="Droga"
      placeholder="Todas las drogas"
      search={search}
      value={drogaActual ? { value: drogaActual.id, label: drogaActual.nombre } : null}
      onChange={(option) => {
        if (!option) {
          if (drogaActual) router.push(hrefConParam(listaHref, "drogaId", ""), { scroll: false });
          return;
        }
        if (option.value !== drogaActual?.id) router.push(hrefConParam(listaHref, "drogaId", option.value), { scroll: false });
      }}
    />
  );
}
