/**
 * Pure partida proposal/split function (M07, FASE 5 point 5.6, INV-S13/S14/
 * S16/S18/S19/S20). NO I/O, NO Prisma -- callers (FASE 8, when the
 * confirmation flow is built) load the eligible partidas and pass them in;
 * this function only decides HOW to split a requested quantity across them.
 *
 * Rules implemented (plan §9 M07 + FASE 5 point 5.6):
 *   - INV-S10: an expired partida (fechaVencimiento < jornadaActual) is
 *     NEVER proposed, full stop.
 *   - INV-S16/S18: if an ABIERTA partida (fechaApertura not null) exists
 *     for this droga, it is consumed FIRST -- opening a second one is a
 *     separate [APP] decision (motivo_apertura_adicional) outside this
 *     function's scope.
 *   - INV-S13/S19/S20 (FEFO for the rest): once every abierta partida with
 *     balance is exhausted, the remaining quantity is drawn from CERRADA
 *     partidas in ascending fechaVencimiento order (first to expire,
 *     first consumed).
 *   - "Consume fully before moving on": every partida in the returned split
 *     EXCEPT POSSIBLY THE LAST is used for its ENTIRE cantidadDisponible.
 *     Only the last line may leave the partida with remaining balance.
 *   - The sum of `cantidad` across every returned line is EXACTLY
 *     `cantidadRequerida` -- the caller/user never edits these amounts
 *     (plan §9 M07 historia "el sistema calcula los montos").
 *   - Multiple simultaneous abiertas (should not normally happen, but the
 *     schema does not forbid it) are consumed oldest-fechaApertura-first --
 *     a deterministic tie-break, documented here since the plan does not
 *     specify one.
 *
 * `jornadaActual` and `fechaApertura`/`fechaVencimiento` are plain ISO
 * strings (`YYYY-MM-DD` for dates, any ISO-8601 instant for fechaApertura)
 * so this function never needs a `Date`/timezone of its own -- the caller
 * (an [APP] query, FASE 8) is responsible for deriving them from
 * `fsj.jornada_actual(tenantId)` / the real partida rows, mirroring
 * `shared/time/jornada.ts`'s "always derive jornada from the server, never
 * trust the client" rule.
 */
import { Decimal } from "decimal.js";
import { dec } from "@/shared/decimal";

export interface PartidaDisponible {
  id: string;
  /** partida.cantidad_disponible, as of the read that produced this list. */
  cantidadDisponible: Decimal | string;
  /** `YYYY-MM-DD`. */
  fechaVencimiento: string;
  /** ISO-8601 instant, or `null` if the partida has never been opened. */
  fechaApertura: string | null;
}

export interface PropuestaLinea {
  partidaId: string;
  cantidad: Decimal;
}

export type PropuestaRepartoResultado =
  | { ok: true; lineas: readonly PropuestaLinea[] }
  | { ok: false; motivo: "STOCK_INSUFICIENTE"; faltante: Decimal };

/** `true` when `fechaVencimiento` is strictly before `jornadaActual` (both `YYYY-MM-DD`, safe to compare lexically). */
function estaVencida(fechaVencimiento: string, jornadaActual: string): boolean {
  return fechaVencimiento < jornadaActual;
}

/**
 * Proposes how to split `cantidadRequerida` (in the droga's unidad base)
 * across `partidas`. `partidas` should already be scoped to ONE droga --
 * this function does not filter by droga (it has no droga id to filter on),
 * it only orders/excludes/splits whatever list it is given.
 */
export function proponerReparto(
  partidas: readonly PartidaDisponible[],
  cantidadRequerida: Decimal | string,
  jornadaActual: string,
): PropuestaRepartoResultado {
  const requerida = dec(cantidadRequerida);
  if (!requerida.greaterThan(0)) {
    throw new RangeError("proponerReparto: cantidadRequerida must be greater than zero.");
  }

  const elegibles = partidas.filter(
    (p) => !estaVencida(p.fechaVencimiento, jornadaActual) && dec(p.cantidadDisponible).greaterThan(0),
  );

  const abiertas = elegibles
    .filter((p) => p.fechaApertura !== null)
    .slice()
    .sort((a, b) => (a.fechaApertura! < b.fechaApertura! ? -1 : a.fechaApertura! > b.fechaApertura! ? 1 : 0));

  const cerradas = elegibles
    .filter((p) => p.fechaApertura === null)
    .slice()
    .sort((a, b) => (a.fechaVencimiento < b.fechaVencimiento ? -1 : a.fechaVencimiento > b.fechaVencimiento ? 1 : 0));

  const ordenDeConsumo = [...abiertas, ...cerradas];

  const lineas: PropuestaLinea[] = [];
  let restante = requerida;

  for (const partida of ordenDeConsumo) {
    if (!restante.greaterThan(0)) break;
    const disponible = dec(partida.cantidadDisponible);
    const aTomar = Decimal.min(disponible, restante);
    lineas.push({ partidaId: partida.id, cantidad: aTomar });
    restante = restante.minus(aTomar);
  }

  if (restante.greaterThan(0)) {
    return { ok: false, motivo: "STOCK_INSUFICIENTE", faltante: restante };
  }

  return { ok: true, lineas };
}
