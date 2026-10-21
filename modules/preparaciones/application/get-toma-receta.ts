/**
 * `getTomaReceta` (M11): everything the toma workspace
 * (/preparaciones/recetas/[recetaId]) shows -- the receta (header, toma,
 * ítems with componentes), each ítem's ficha técnica with its líneas de
 * pesaje (its live preparación's, else the latest version -- R20), and each
 * ítem's INICIADA/CONFIRMADA preparación. `null` when the receta does not
 * exist (in this tenant).
 *
 * Per Pendiente ítem (docs/specs/reserva-stock-preparacion.md):
 *   - R18: whether its ficha is still vigente (`evaluarFichaDeItemEnTx`,
 *     modules/elaboracion: the latest version, built from the ítem's current
 *     data); a desactualizada one can not be reserved and the page offers
 *     "Generar ficha técnica".
 *   - R21: every non-manual línea of a vigente ficha lists the partidas the
 *     AUTOMATIC reserva will take, with how much of each (physical,
 *     purity-corrected, línea unit), or its faltante
 *     (./partidas-para-pesar.ts). An ítem with stock reserved lists its
 *     reservas instead (migration 0071).
 * Per CONFIRMADA ítem, R22: why its etiqueta can not be printed any more
 * (asiento sin efecto), if so.
 *
 * `preparaciones.iniciar`, like every /preparaciones read. The embedded
 * receta edit form reads its own data through `recetas.ver` (recetas
 * module), gated on the recetas permisos by the page.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { MENSAJE_VENCIDA_REQUIERE_DT, estadoVencimientoPartida, textoPorVencer } from "@/modules/stock/domain/vencimiento-partida";
import { diasAlertaVencimientoEnTx } from "@/modules/stock/application/dias-alerta-vencimiento";
import { evaluarFichaDeItemEnTx } from "@/modules/elaboracion/application/estado-ficha";
import { motivoEtiquetaNoImprimible } from "../domain/etiqueta";
import { getMesesVencimientoPreparado, getRecetaDeToma, jornadaActualTenant } from "../infrastructure/preparacion-repository";
import type {
  FichaDeItemToma as FichaDeItemTomaBase,
  ItemDeToma as ItemDeTomaBase,
  LineaDeFichaToma as LineaDeFichaTomaBase,
  PreparacionDeItemToma as PreparacionDeItemTomaBase,
  RecetaDeToma as RecetaDeTomaBase,
  ReservaDeItemToma as ReservaDeItemTomaBase,
} from "../infrastructure/preparacion-repository";
import { asignacionDeLinea, cargarPartidasPorDroga, esLineaPesable } from "./partidas-para-pesar";
import type { PartidaParaPesar } from "./partidas-para-pesar";

export type { PartidaParaPesar };

export interface LineaDeFichaToma extends LineaDeFichaTomaBase {
  /** `null` for manual-enrase líneas, líneas without cantidadAPesar, and ítems already CONFIRMADA, with stock reserved or with a desactualizada ficha. */
  partidas: PartidaParaPesar[] | null;
  /** The automatic reserva lacks this much of the droga (línea unit, active terms); `null` when it has the stock or nothing was computed. */
  faltante: string | null;
}

export interface FichaDeItemToma extends Omit<FichaDeItemTomaBase, "lineas"> {
  lineas: LineaDeFichaToma[];
}

export interface ReservaDeItemToma extends ReservaDeItemTomaBase {
  /** The reserved partida is por vencer ("Vence en 5 días") or vencida (blocked until the DT acts, docs/specs/reanalisis-partida.md); `null` otherwise. */
  avisoVencimiento: string | null;
  vencida: boolean;
}

export interface PreparacionDeItemToma extends Omit<PreparacionDeItemTomaBase, "reservas"> {
  reservas: ReservaDeItemToma[];
  /** CONFIRMADA only: why its etiqueta can no longer be printed (R22); `null` = printable. */
  etiquetaNoImprimible: string | null;
}

export interface ItemDeToma extends Omit<ItemDeTomaBase, "ficha" | "preparacion"> {
  ficha: FichaDeItemToma | null;
  preparacion: PreparacionDeItemToma | null;
  /** Pendiente ítem whose ficha is not vigente (R18): why; `null` = vigente (or not applicable). */
  fichaDesactualizada: string | null;
}

export interface RecetaDeToma extends Omit<RecetaDeTomaBase, "items"> {
  items: ItemDeToma[];
  /** `meses_vencimiento_preparado`: the months of the `ESTANDAR` tipo in "Imprimir etiquetas" (docs/specs/vencimiento-preparado.md R10). */
  mesesVencimientoPreparado: number;
}

const getTomaRecetaInput = z.object({ recetaId: uuid });

export const getTomaRecetaQuery = defineQuery({
  name: "preparaciones.toma.ver",
  permiso: "preparaciones.iniciar",
  input: getTomaRecetaInput,
  handler: async ({ tx, session, input }): Promise<RecetaDeToma | null> => {
    const receta = await getRecetaDeToma(tx, session.tenantId, input.recetaId);
    if (!receta) return null;

    // R18: only a Pendiente ítem (no live preparación) is about to be reserved on its (latest) ficha.
    const desactualizada = new Map<string, string>();
    for (const item of receta.items) {
      if (item.preparacion || !item.ficha) continue;
      const estado = await evaluarFichaDeItemEnTx(tx, session.tenantId, item.id, item.ficha.id);
      if (!estado.vigente) desactualizada.set(item.id, estado.mensaje);
    }

    // R21: a Pendiente ítem with a vigente ficha shows the automatic assignment.
    const porReservar = (item: ItemDeTomaBase) => item.preparacion === null && !desactualizada.has(item.id);
    const lineasPorPesar = (item: ItemDeTomaBase) => (porReservar(item) ? (item.ficha?.lineas ?? []) : []);
    const partidasPorDroga = await cargarPartidasPorDroga(
      tx,
      session.tenantId,
      receta.items.flatMap((item) => lineasPorPesar(item).filter(esLineaPesable).map((l) => l.drogaId)),
    );

    // Expiry of the reserved partidas (vencimiento vigente), read only when there is any.
    const hayReservas = receta.items.some((item) => (item.preparacion?.reservas.length ?? 0) > 0);
    const jornada = hayReservas ? await jornadaActualTenant(tx, session.tenantId) : "";
    const diasAlerta = hayReservas ? await diasAlertaVencimientoEnTx(tx, session.tenantId) : 0;
    const conVencimiento = (reserva: ReservaDeItemTomaBase): ReservaDeItemToma => {
      const estado = estadoVencimientoPartida(reserva.fechaVencimiento, jornada, diasAlerta);
      const aviso =
        estado === "VENCIDA" ? MENSAJE_VENCIDA_REQUIERE_DT : estado === "POR_VENCER" && reserva.fechaVencimiento ? textoPorVencer(reserva.fechaVencimiento, jornada) : null;
      return { ...reserva, avisoVencimiento: aviso, vencida: estado === "VENCIDA" };
    };

    return {
      ...receta,
      mesesVencimientoPreparado: await getMesesVencimientoPreparado(tx, session.tenantId),
      items: receta.items.map((item) => ({
        ...item,
        fichaDesactualizada: desactualizada.get(item.id) ?? null,
        preparacion: item.preparacion
          ? {
              ...item.preparacion,
              reservas: item.preparacion.reservas.map(conVencimiento),
              etiquetaNoImprimible:
                item.preparacion.estado === "CONFIRMADA"
                  ? motivoEtiquetaNoImprimible({ recetaEstado: receta.estado, asientoSinEfecto: item.preparacion.asientoSinEfecto, asientoNumeroCorrelativo: null })
                  : null,
            }
          : null,
        ficha: item.ficha
          ? {
              ...item.ficha,
              lineas: item.ficha.lineas.map((linea) => {
                const asignacion = porReservar(item) ? asignacionDeLinea(partidasPorDroga, linea) : null;
                return { ...linea, partidas: asignacion?.partidas ?? null, faltante: asignacion?.faltante ?? null };
              }),
            }
          : null,
      })),
    };
  },
});

export async function getTomaReceta(recetaId: string): Promise<RecetaDeToma | null> {
  return getTomaRecetaQuery.execute({ recetaId });
}
