/**
 * Header block of the "Comparador de costos" result (docs/specs/comparador-costos.md,
 * "Header above the table"): the droga, its unidad base, the display-unit
 * note, the period, the IVA/flete assumption and the notices (partidas with
 * cost 0 left out, a single proveedor). Presentational server component.
 */
import { formatFecha } from "@/shared/format/fecha";
import { formatNumero } from "@/shared/format/cantidad";
import { ToneBadge } from "@/shared/ui/status-badge";
import { MESES_COMPRA_ANTIGUA, MIN_PARTIDAS_PARA_ATIPICOS, PERIODO_LABELS } from "../domain/comparador-costos";
import type { ComparacionCostos } from "../domain/comparador-costos";

const AVISO_ADVERTENCIA = "rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950";
const AVISO_INFORMATIVO = "rounded border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900";

export function ComparadorEncabezado({ comparacion }: { comparacion: ComparacionCostos }) {
  const { droga, unidadBase, unidadMostrada, convertida, periodo, inicioPeriodo, zonaHoraria, partidasCostoCero, sinOtrosProveedores } = comparacion;
  const costoCero = partidasCostoCero;

  return (
    <section aria-labelledby="comparador-droga-titulo" className="mb-6 min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id="comparador-droga-titulo" className="min-w-0 text-lg font-medium">
          {droga.nombre}
        </h2>
        {droga.deBaja ? <ToneBadge tone="neutral">Droga de baja</ToneBadge> : null}
      </div>

      <dl className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-zinc-500">Unidad base</dt>
          <dd className="text-sm">{unidadBase.simbolo}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-zinc-500">Costos por</dt>
          <dd className="text-sm">
            {convertida ? `${unidadMostrada.simbolo} — convertidos desde la unidad base ${unidadBase.simbolo}` : `${unidadMostrada.simbolo} (unidad base)`}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-zinc-500">Período</dt>
          <dd className="text-sm">
            {PERIODO_LABELS[periodo]}
            {inicioPeriodo ? ` (desde el ${formatFecha(inicioPeriodo, zonaHoraria)})` : ""}
          </dd>
        </div>
      </dl>

      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Los costos se comparan tal como fueron cargados en cada ingreso. El sistema no registra IVA, flete ni bonificaciones, por lo que se asume que todos los
        proveedores se cargaron con el mismo criterio. Si un costo se corrigió, se muestra el valor corregido.
      </p>

      <p className="mb-3 text-xs text-zinc-500">
        <b className="font-medium">Revisar</b>: algún costo es más de 10 veces o menos de la décima parte de la mediana de la droga en el período (se evalúa a partir de{" "}
        {MIN_PARTIDAS_PARA_ATIPICOS} partidas con costo); puede ser un error de unidad al cargarlo y no se usa para marcar al «Más barato». <b className="font-medium">Antiguo</b>: la
        última compra tiene más de {MESES_COMPRA_ANTIGUA} meses.
      </p>

      <div className="flex flex-col gap-2">
        {costoCero > 0 ? (
          <p role="note" className={AVISO_ADVERTENCIA}>
            {formatNumero(String(costoCero))} partida{costoCero === 1 ? "" : "s"} con costo $&nbsp;0 no se {costoCero === 1 ? "considera" : "consideran"} en los costos, el
            promedio ni el ranking.
          </p>
        ) : null}
        {sinOtrosProveedores ? (
          <p role="note" className={AVISO_INFORMATIVO}>
            Sin otros proveedores para comparar: hay menos de dos proveedores vigentes con costo en el período, por lo que no se marca ninguno como «Más barato».
          </p>
        ) : null}
      </div>
    </section>
  );
}
