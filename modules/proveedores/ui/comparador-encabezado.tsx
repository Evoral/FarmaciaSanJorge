/**
 * Header block of the "Comparador de costos" result (docs/specs/comparador-costos.md,
 * "Header above the table"): the droga, its unidad base, the display-unit
 * note, the period, the IVA/flete assumption and the notices (partidas with
 * cost 0 left out, a single proveedor). Presentational server component.
 */
import { CircleAlert, Info } from "lucide-react";
import { formatFecha } from "@/shared/format/fecha";
import { formatNumero } from "@/shared/format/cantidad";
import { ToneBadge } from "@/shared/ui/status-badge";
import { MESES_COMPRA_ANTIGUA, MIN_PARTIDAS_PARA_ATIPICOS, PERIODO_LABELS } from "../domain/comparador-costos";
import type { ComparacionCostos } from "../domain/comparador-costos";

export function ComparadorEncabezado({ comparacion }: { comparacion: ComparacionCostos }) {
  const { droga, unidadBase, unidadMostrada, convertida, periodo, inicioPeriodo, zonaHoraria, partidasCostoCero, sinOtrosProveedores } = comparacion;
  const costoCero = partidasCostoCero;

  return (
    <section aria-labelledby="comparador-droga-titulo" className="mb-4 flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 id="comparador-droga-titulo" className="min-w-0 text-lg font-semibold text-zinc-900">
            {droga.nombre}
          </h2>
          {droga.deBaja ? <ToneBadge tone="neutral">Droga de baja</ToneBadge> : null}
        </div>
        <dl className="meta-line">
          <div className="flex gap-1.5">
            <dt>Unidad base</dt>
            <dd className="font-mono text-zinc-900">{unidadBase.simbolo}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Costos por</dt>
            <dd className="text-zinc-900">
              <span className="font-mono">{unidadMostrada.simbolo}</span>
              {convertida ? <span className="text-zinc-500"> (convertidos desde {unidadBase.simbolo})</span> : null}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Período</dt>
            <dd className="text-zinc-900">
              {PERIODO_LABELS[periodo]}
              {inicioPeriodo ? <span className="text-zinc-500"> (desde el {formatFecha(inicioPeriodo, zonaHoraria)})</span> : null}
            </dd>
          </div>
        </dl>
      </div>

      {costoCero > 0 ? (
        <p role="note" className="alert alert-warn">
          <CircleAlert aria-hidden />
          <span>
            {formatNumero(String(costoCero))} partida{costoCero === 1 ? "" : "s"} con costo $&nbsp;0 no se {costoCero === 1 ? "considera" : "consideran"} en los costos, el
            promedio ni el ranking.
          </span>
        </p>
      ) : null}
      {sinOtrosProveedores ? (
        <p role="note" className="alert alert-info">
          <Info aria-hidden />
          <span>Sin otros proveedores para comparar: hay menos de dos proveedores vigentes con costo en el período, por lo que no se marca ninguno como «Más barato».</span>
        </p>
      ) : null}

      <p className="max-w-[75ch] text-xs leading-relaxed text-zinc-600">
        Los costos se comparan tal como fueron cargados en cada ingreso. El sistema no registra IVA, flete ni bonificaciones, por lo que se asume que todos los
        proveedores se cargaron con el mismo criterio. Si un costo se corrigió, se muestra el valor corregido.
      </p>

      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer select-none font-medium text-zinc-600 hover:text-zinc-900">Qué significan «Revisar» y «Antiguo»</summary>
        <div className="mt-2 max-w-[75ch] leading-relaxed">
          <p>
            <b className="font-medium text-zinc-700">Revisar</b>: algún costo es más de 10 veces o menos de la décima parte de la mediana de la droga en el período (se evalúa a
            partir de {MIN_PARTIDAS_PARA_ATIPICOS} partidas con costo); puede ser un error de unidad al cargarlo y no se usa para marcar al «Más barato».{" "}
            <b className="font-medium text-zinc-700">Antiguo</b>: la última compra tiene más de {MESES_COMPRA_ANTIGUA} meses.
          </p>
        </div>
      </details>
    </section>
  );
}
