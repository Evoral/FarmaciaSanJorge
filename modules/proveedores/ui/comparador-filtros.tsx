/**
 * Filters of the "Comparador de costos" (docs/specs/comparador-costos.md): the
 * system's standard `FilterForm` (auto-applying GET form) with three selects,
 * laid out like the other list pages (label + `select.input`):
 *
 *   - Droga (`droga`): every droga with partidas, vigentes first, then the
 *     ones "(de baja)". An empty first option = nothing selected.
 *   - Mostrar costo por (`unidad`): the display unit. The empty first option is
 *     the default unit ("Predeterminada (g)"), so the URL stays clean until a
 *     unit is really picked. Disabled (and therefore not submitted) while no
 *     droga is selected. Re-mounted (`key` = droga) when the droga changes so it
 *     lists the new droga's units. The form still submits the previous `unidad`
 *     together with the new droga: a unit that does not exist for the new
 *     droga's magnitude falls back to the default, but a valid one (same
 *     magnitude, or `base`, which is always the NEW droga's own base) is kept.
 *     The unit actually in force is always written in the result header
 *     ("Costos por ..."), which is what to read.
 *   - Período (`periodo`): empty first option = "Últimos 12 meses" (default).
 *
 * `FilterForm` drops empty fields from the URL and "Limpiar filtros" empties
 * every select, so a cleared form is the bare `/comparador-costos`. Server
 * component: options and defaults come from the use case, never the raw URL.
 */
import { FilterForm } from "@/shared/ui/filter-form";
import { PERIODOS_COMPARADOR, PERIODO_LABELS, etiquetaOpcionDroga, unidadPredeterminada } from "../domain/comparador-costos";
import type { ComparacionCostos, DrogaOpcion, PeriodoComparador } from "../domain/comparador-costos";

export interface ComparadorFiltrosProps {
  drogas: readonly DrogaOpcion[];
  /** The selected droga, only when it is one of `drogas`. */
  drogaId: string | null;
  periodo: PeriodoComparador;
  /** `unidad` as it is in the URL (parsed): `"base"`, a unit `codigo` or `null`. */
  unidadEnUrl: string | null;
  /** The comparison in force (gives the unit options); `null` without a droga. */
  comparacion: ComparacionCostos | null;
  /** Any of the three params is in the URL: shows "Limpiar filtros". */
  hayFiltros: boolean;
}

export function ComparadorFiltros({ drogas, drogaId, periodo, unidadEnUrl, comparacion, hayFiltros }: ComparadorFiltrosProps) {
  const opcionesUnidad = comparacion?.opcionesUnidad ?? [];
  const predeterminada = comparacion ? unidadPredeterminada(comparacion.unidadBase, opcionesUnidad) : null;
  // Same matching as `resolverUnidadCosto`: the param may name the base unit by its codigo too.
  const pedida = unidadEnUrl?.toLowerCase();
  const unidadElegida = pedida ? (opcionesUnidad.find((o) => o.valor.toLowerCase() === pedida || o.unidad.codigo.toLowerCase() === pedida)?.valor ?? "") : "";

  return (
    <FilterForm className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros del comparador de costos" hasActiveFilters={hayFiltros}>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="comparador-droga" className="text-sm font-medium">
          Droga
        </label>
        <select id="comparador-droga" name="droga" defaultValue={drogaId ?? ""} className="input min-w-0 max-w-full sm:w-72">
          <option value="">Seleccione una droga…</option>
          {drogas.map((droga) => (
            <option key={droga.id} value={droga.id}>
              {etiquetaOpcionDroga(droga)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="comparador-unidad" className="text-sm font-medium">
          Mostrar costo por
        </label>
        <select
          key={drogaId ?? "sin-droga"}
          id="comparador-unidad"
          name="unidad"
          defaultValue={unidadElegida}
          disabled={comparacion === null}
          className="input min-w-0 max-w-full"
        >
          {predeterminada ? (
            <>
              <option value="">Predeterminada ({predeterminada.unidad.simbolo})</option>
              {opcionesUnidad.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
            </>
          ) : (
            <option value="">Seleccione una droga primero</option>
          )}
        </select>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="comparador-periodo" className="text-sm font-medium">
          Período
        </label>
        <select id="comparador-periodo" name="periodo" defaultValue={periodo === "12m" ? "" : periodo} className="input min-w-0 max-w-full">
          <option value="">{PERIODO_LABELS["12m"]}</option>
          {PERIODOS_COMPARADOR.filter((p) => p !== "12m").map((p) => (
            <option key={p} value={p}>
              {PERIODO_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
    </FilterForm>
  );
}
