/**
 * Which ítem a sub-screen is about (ficha técnica, cotización): position,
 * name, forma, cantidades. Same vocabulary as the ítem cards on the receta
 * detail, so the user recognizes it. Server-safe presentational component.
 */
import { FORMA_FARMACEUTICA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";

export interface ItemContextoProps {
  item: {
    descripcion: string | null;
    formaFarmaceutica: string;
    cantidadUnidades: number;
    cantidadTotal: string | null;
    unidadTotalSimbolo: string | null;
  };
  /** 1-based position in the receta. */
  posicion: number;
}

export function ItemContexto({ item, posicion }: ItemContextoProps) {
  const forma = etiquetaDe(FORMA_FARMACEUTICA_LABELS, item.formaFarmaceutica);
  return (
    <section className="panel" aria-label="Ítem de la receta">
      <div className="flex items-start gap-3 p-4">
        <span className="index-badge mt-0.5" aria-hidden>
          {posicion}
        </span>
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">Ítem {posicion}</p>
          <p className="font-medium text-zinc-900">{item.descripcion ?? forma}</p>
          <p className="meta-line mt-1 text-xs">
            <span>{forma}</span>
            <span className="tabular-nums">
              {item.cantidadUnidades} {item.cantidadUnidades === 1 ? "unidad" : "unidades"}
            </span>
            {item.cantidadTotal ? (
              <span className="tabular-nums">
                Total {item.cantidadTotal} {item.unidadTotalSimbolo ?? ""}
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </section>
  );
}
