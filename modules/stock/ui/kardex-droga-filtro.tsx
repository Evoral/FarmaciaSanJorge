"use client";

/**
 * Droga filter of `/reportes/kardex`: an AUTOCOMPLETE over the existing stock droga search (`buscarDrogasStockAction`,
 * same `stock.ver` permiso as the kardex). Picking a droga sets the page's `drogaId` param (the same uuid the old
 * free-text "Droga (ID)" field took); clearing the box removes it. The other filters stay in the URL.
 */
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/shared/ui/combobox";
import { hrefConParam } from "@/shared/ui/href-con-param";
import { buscarDrogasStockAction } from "./buscar-drogas-stock-action";

export interface KardexDrogaFiltroProps {
  /** The kardex URL with its current filters. */
  href: string;
  /** The droga currently filtered, when known. */
  seleccion: { id: string; nombre: string } | null;
}

export function KardexDrogaFiltro({ href, seleccion }: KardexDrogaFiltroProps) {
  const router = useRouter();

  const search = useCallback(async (q: string) => {
    const drogas = await buscarDrogasStockAction(q);
    return drogas.map((d) => ({ value: d.drogaId, label: d.drogaNombre, description: d.disponible }));
  }, []);

  return (
    <Combobox
      id="kardex-droga"
      label="Droga"
      hideLabel
      placeholder="Filtrar por droga"
      search={search}
      value={seleccion ? { value: seleccion.id, label: seleccion.nombre } : null}
      onChange={(option) => router.push(hrefConParam(href, "drogaId", option?.value ?? ""), { scroll: false })}
    />
  );
}
