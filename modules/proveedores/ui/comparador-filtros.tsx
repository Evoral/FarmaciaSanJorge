/**
 * Filters of the "Comparador de costos" (docs/specs/comparador-costos.md), in
 * one filter bar:
 *
 *   - Droga (`droga`): an AUTOCOMPLETE (`ComparadorDrogaBuscador`) over every
 *     droga with partidas, vigentes first, then the ones "(de baja)". It
 *     navigates on its own; a hidden `droga` input keeps it in the
 *     `FilterForm` (auto-applying GET form) that holds the two selects below.
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
 * `FilterForm` drops empty fields from the URL; "Limpiar" goes to the bare
 * `/comparador-costos`. Server component (the droga autocomplete is the only
 * client piece): options and defaults come from the use case, never the raw URL.
 */
import Link from "next/link";
import { FilterForm } from "@/shared/ui/filter-form";
import { PERIODOS_COMPARADOR, PERIODO_LABELS, etiquetaOpcionDroga, unidadPredeterminada } from "../domain/comparador-costos";
import type { ComparacionCostos, DrogaOpcion, PeriodoComparador } from "../domain/comparador-costos";
import { ComparadorDrogaBuscador } from "./comparador-droga-buscador";

export interface ComparadorFiltrosProps {
  drogas: readonly DrogaOpcion[];
  /** The selected droga, only when it is one of `drogas`. */
  drogaId: string | null;
  periodo: PeriodoComparador;
  /** `unidad` as it is in the URL (parsed): `"base"`, a unit `codigo` or `null`. */
  unidadEnUrl: string | null;
  /** The comparison in force (gives the unit options); `null` without a droga. */
  comparacion: ComparacionCostos | null;
  /** Any of the three params is in the URL: shows "Limpiar". */
  hayFiltros: boolean;
  /** `/comparador-costos` with its current (parsed) params, for the droga autocomplete. */
  hrefActual: string;
}

export function ComparadorFiltros({ drogas, drogaId, periodo, unidadEnUrl, comparacion, hayFiltros, hrefActual }: ComparadorFiltrosProps) {
  const opcionesUnidad = comparacion?.opcionesUnidad ?? [];
  const predeterminada = comparacion ? unidadPredeterminada(comparacion.unidadBase, opcionesUnidad) : null;
  // Same matching as `resolverUnidadCosto`: the param may name the base unit by its codigo too.
  const pedida = unidadEnUrl?.toLowerCase();
  const unidadElegida = pedida ? (opcionesUnidad.find((o) => o.valor.toLowerCase() === pedida || o.unidad.codigo.toLowerCase() === pedida)?.valor ?? "") : "";
  const opcionesDroga = drogas.map((droga) => ({ value: droga.id, label: etiquetaOpcionDroga(droga) }));
  const seleccion = opcionesDroga.find((o) => o.value === drogaId) ?? null;

  return (
    <section aria-label="Filtros del comparador" className="mb-6">
      <div className="filter-bar items-end">
        <div className="min-w-0 flex-1 md:w-80 md:flex-none">
          <ComparadorDrogaBuscador opciones={opcionesDroga} seleccion={seleccion} href={hrefActual} />
        </div>

        <FilterForm className="flex flex-wrap items-end gap-3" aria-label="Unidad y período del comparador" hasActiveFilters={false}>
          {/* The droga is chosen in the autocomplete; this keeps it while the unit or the período change. */}
          <input type="hidden" name="droga" value={drogaId ?? ""} />
          <div className="field min-w-0">
            <label htmlFor="comparador-unidad" className="field-label">
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
                <option value="">Elegí una droga primero</option>
              )}
            </select>
          </div>

          <div className="field min-w-0">
            <label htmlFor="comparador-periodo" className="field-label">
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

        {hayFiltros ? (
          <Link href="/comparador-costos" scroll={false} className="btn btn-ghost btn-sm">
            Limpiar
          </Link>
        ) : null}
      </div>
    </section>
  );
}
