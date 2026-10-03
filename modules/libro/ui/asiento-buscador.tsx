"use client";

/**
 * Paciente/médico autocomplete for `/libro`, over `buscarAsientosRecetarioAction` (libro.ver). Typing lists the
 * matching asientos (paciente, Nº, fecha, médico); picking one opens it. The last row applies the typed text as the
 * list's own `texto` filter; clearing the box removes that filter.
 */
import { ListFilter } from "lucide-react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/shared/ui/combobox";
import { hrefConParam } from "@/shared/ui/href-con-param";
import { formatFechaIso } from "@/shared/format/fecha";
import { buscarAsientosRecetarioAction } from "./buscar-asientos-action";

export interface AsientoBuscadorProps {
  /** The list's URL without `texto` (the other filters kept). */
  listaHref: string;
  /** The list's current `texto` filter, shown in the box. */
  busquedaActual?: string;
}

export function AsientoBuscador({ listaHref, busquedaActual }: AsientoBuscadorProps) {
  const router = useRouter();

  const search = useCallback(async (q: string) => {
    const items = await buscarAsientosRecetarioAction(q);
    return items.map((item) => ({
      value: item.id,
      label: `${item.pacienteTexto} · ${item.medicoTexto}`,
      description: `Nº ${item.numeroCorrelativo} · ${formatFechaIso(item.fechaAsiento)}`,
    }));
  }, []);

  return (
    <Combobox
      id="texto-buscar"
      label="Buscar por paciente o médico"
      hideLabel
      placeholder="Buscar por paciente o médico"
      search={search}
      value={busquedaActual ? { value: "", label: busquedaActual } : null}
      onChange={(option) => {
        if (!option) {
          if (busquedaActual) router.push(hrefConParam(listaHref, "texto", ""), { scroll: false });
          return;
        }
        router.push(`/libro/${option.value}`);
      }}
      actionOption={{
        label: (q) => (q ? `Filtrar la lista por “${q}”` : "Ver todos los asientos"),
        onSelect: (q) => router.push(hrefConParam(listaHref, "texto", q), { scroll: false }),
        icon: <ListFilter className="size-4 flex-none" aria-hidden />,
      }}
    />
  );
}
