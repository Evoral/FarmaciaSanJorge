/**
 * What has to be prepared for a receta ítem -- forma farmacéutica, cantidades, posología and componentes -- worded like
 * the receta detail page's ítem card. Shared by the Pendientes "Ver" preview and the toma workspace. Plain
 * presentational component (no hooks): renders from both Server and Client Components.
 */
import { FORMA_FARMACEUTICA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { ComponentesTabla } from "@/modules/recetas/ui/componentes-tabla";
import type { ComponenteVista } from "@/modules/recetas/ui/componentes-tabla";

export interface ItemDatosVista {
  formaFarmaceutica: string;
  cantidadUnidades: number;
  cantidadTotal: string | null;
  unidadTotalSimbolo: string | null;
  posologia: string | null;
  duracionTratamientoDias: number | null;
  componentes: readonly ComponenteVista[];
}

export function ItemDatos({ item }: { item: ItemDatosVista }) {
  return (
    <>
      <p className="mb-2 text-sm font-medium">
        {etiquetaDe(FORMA_FARMACEUTICA_LABELS, item.formaFarmaceutica)} — {item.cantidadUnidades} unidad
        {item.cantidadUnidades === 1 ? "" : "es"}
        {item.cantidadTotal ? `, total ${item.cantidadTotal} ${item.unidadTotalSimbolo ?? ""}` : ""}
      </p>
      {item.posologia || item.duracionTratamientoDias ? (
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          {item.posologia ? `Posología: ${item.posologia}` : ""}
          {item.posologia && item.duracionTratamientoDias ? " · " : ""}
          {item.duracionTratamientoDias ? `Tratamiento por ${item.duracionTratamientoDias} día${item.duracionTratamientoDias === 1 ? "" : "s"}` : ""}
        </p>
      ) : null}
      <ComponentesTabla componentes={item.componentes} />
    </>
  );
}
