/**
 * `getHistorialDroga` (docs/specs/historial-droga.md): read-only "every receta
 * that CONSUMED this droga, and from which partida(s)", for
 * `/catalogos/drogas/[id]/historial`. HEALTH-ADJACENT DATA (recetas, pacientes,
 * Ley 25.326): the URL carries only the opaque droga id, a plain `?page=`
 * integer and the optional repeatable `?partida=<uuid>` filter (partida ids are
 * not sensitive); nothing here is ever logged.
 *
 * Gated on `recetas.crear` -- the broadest recetas.* permiso, the one the
 * `/recetas/**` layout and `getReceta` ("recetas.ver") guard on (the spec's
 * `recetas.ver` is a use-case name, not a permiso code; plan D1).
 *
 * `defineQuery` takes ONE permiso (and a denial writes an ACCESO_DENEGADO audit
 * row), so the optional pieces use `can()` instead of other `defineQuery` use
 * cases: the paciente name (`pacientes.gestionar`) is not even queried without
 * it, and `stock.ver` only gates the partida link and the unit conversion in
 * the UI. Reads are not audited (project convention). Returns `null` when the
 * droga does not exist in the tenant (the page answers 404).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { uuid } from "@/shared/validation";
import { PAGE_MAX_HISTORIAL_DROGA, PAGE_SIZE_HISTORIAL_DROGA, PARTIDAS_FILTRO_MAX, armarHistorialDroga } from "../domain/historial";
import type { AccesoHistorialDroga, HistorialDroga } from "../domain/historial";
import { getHistorialDrogaCruda } from "../infrastructure/historial-repository";

export type { HistorialDroga };

const getHistorialDrogaInput = z.object({
  drogaId: uuid,
  page: z.number().int().min(1).max(PAGE_MAX_HISTORIAL_DROGA).default(1),
  /** Partida filter (OR): ids that are not one of the droga's option partidas are ignored by the repository. Empty = no filter. */
  partidaIds: z.array(uuid).max(PARTIDAS_FILTRO_MAX).default([]),
});

export type GetHistorialDrogaInput = z.input<typeof getHistorialDrogaInput>;

/** Each flag is the permiso of the piece / of the target page's own guard. */
export function accesoHistorialDroga(session: AuthenticatedSession): AccesoHistorialDroga {
  return {
    pacientes: can(session, "pacientes.gestionar"),
    stock: can(session, "stock.ver"),
  };
}

/**
 * THE rule for "may this session see the Historial": the tab (`DrogaTabs`) and
 * the page both ask it, so the UI never shows a link the page would turn away
 * and the page never calls the use case (which would audit a denial) for a
 * session that cannot pass it.
 */
export function puedeVerHistorialDroga(session: AuthenticatedSession): boolean {
  return can(session, "recetas.crear");
}

export const getHistorialDrogaQuery = defineQuery({
  name: "drogas.historial",
  permiso: "recetas.crear",
  input: getHistorialDrogaInput,
  handler: async ({ tx, session, input }): Promise<HistorialDroga | null> => {
    const acceso = accesoHistorialDroga(session);
    const cruda = await getHistorialDrogaCruda(tx, session.tenantId, input.drogaId, input.page, PAGE_SIZE_HISTORIAL_DROGA, acceso, input.partidaIds);
    return cruda ? armarHistorialDroga(cruda, acceso) : null;
  },
});

export async function getHistorialDroga(input: GetHistorialDrogaInput): Promise<HistorialDroga | null> {
  return getHistorialDrogaQuery.execute(input);
}
