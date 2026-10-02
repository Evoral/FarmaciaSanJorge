/**
 * `compararCostosDroga` (docs/specs/comparador-costos.md): what each proveedor
 * charged for ONE droga, for `/comparador-costos`. Gated on
 * `stock.valorizado.ver` (the permiso that gates money everywhere else).
 *
 * `defineQuery` takes ONE permiso and a denial writes an ACCESO_DENEGADO audit
 * row, so this use case never calls another one: it reads its own droga
 * options (every droga with at least one partida; NOT `listDrogasOpciones`,
 * gated on `drogas.editar`) and its own unit factors from the repository, and
 * decides the link to `/stock/partidas/[id]` with `can(session, "stock.ver")`.
 * Reads are not audited (project convention). The droga options are ALWAYS
 * returned; the comparison only when `drogaId` is a droga of the tenant that
 * has partidas.
 *
 * No receta / paciente data is read here, ever (see the repository header).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import { uuid } from "@/shared/validation";
import { PERIODOS_COMPARADOR, PERIODO_PREDETERMINADO, armarComparacion, ordenarOpcionesDroga } from "../domain/comparador-costos";
import type { ComparacionCostos, DrogaOpcion, PeriodoComparador } from "../domain/comparador-costos";
import { getComparacionCruda, readDrogasConPartidas } from "../infrastructure/comparador-costos-repository";

export type { ComparacionCostos, DrogaOpcion, PeriodoComparador };

const compararCostosDrogaInput = z.object({
  /** The droga to compare; omitted = only the options. A uuid that is not one of the tenant's drogas with partidas yields `drogaNoDisponible`. */
  drogaId: uuid.optional(),
  /** Display unit of the costs: `"base"` or a unit `codigo`. Whatever does not fit the droga's magnitude falls back to the default unit. */
  unidad: z
    .string()
    .trim()
    .max(32)
    .regex(/^[A-Za-z_]+$/, "Debe ser un código de unidad válido.")
    .optional(),
  periodo: z.enum(PERIODOS_COMPARADOR).default(PERIODO_PREDETERMINADO),
});

export type CompararCostosDrogaInput = z.input<typeof compararCostosDrogaInput>;

export interface ComparadorCostosResultado {
  /** Drogas with at least one partida: vigentes first, then the ones de baja. */
  drogas: DrogaOpcion[];
  periodo: PeriodoComparador;
  /** `null` when no droga was asked for, or the one asked for is not available. */
  comparacion: ComparacionCostos | null;
  /** A droga was asked for but it is not one of the tenant's drogas with partidas. */
  drogaNoDisponible: boolean;
  /** `stock.ver`: the detail rows may link to `/stock/partidas/[id]` (that page's own guard). */
  linkPartida: boolean;
}

export const compararCostosDrogaQuery = defineQuery({
  name: "proveedores.comparar-costos",
  permiso: "stock.valorizado.ver",
  input: compararCostosDrogaInput,
  handler: async ({ tx, session, input }): Promise<ComparadorCostosResultado> => {
    const drogas = ordenarOpcionesDroga(await readDrogasConPartidas(tx, session.tenantId));
    const cruda = input.drogaId ? await getComparacionCruda(tx, session.tenantId, input.drogaId, input.periodo) : null;
    return {
      drogas,
      periodo: input.periodo,
      comparacion: cruda ? armarComparacion(cruda, input.unidad ?? null) : null,
      drogaNoDisponible: input.drogaId !== undefined && cruda === null,
      linkPartida: can(session, "stock.ver"),
    };
  },
});

export async function compararCostosDroga(input: CompararCostosDrogaInput): Promise<ComparadorCostosResultado> {
  return compararCostosDrogaQuery.execute(input);
}
