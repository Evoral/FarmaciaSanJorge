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
    <div className="flex flex-col gap-3">
      <p className="meta-line">
        <span className="font-medium text-zinc-900">{etiquetaDe(FORMA_FARMACEUTICA_LABELS, item.formaFarmaceutica)}</span>
        <span className="tabular-nums">
          {item.cantidadUnidades} {item.cantidadUnidades === 1 ? "unidad" : "unidades"}
        </span>
        {item.cantidadTotal ? (
          <span className="tabular-nums">
            Total {item.cantidadTotal} {item.unidadTotalSimbolo ?? ""}
          </span>
        ) : null}
      </p>
      {item.posologia || item.duracionTratamientoDias ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {item.posologia ? (
            <div>
              <dt className="text-xs text-zinc-500">Posología</dt>
              <dd className="text-zinc-900">{item.posologia}</dd>
            </div>
          ) : null}
          {item.duracionTratamientoDias ? (
            <div>
              <dt className="text-xs text-zinc-500">Tratamiento</dt>
              <dd className="text-zinc-900 tabular-nums">
                {item.duracionTratamientoDias} {item.duracionTratamientoDias === 1 ? "día" : "días"}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <ComponentesTabla componentes={item.componentes} />
    </div>
  );
}
