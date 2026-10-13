/**
 * `getTomaReceta` (M11): everything the toma workspace
 * (/preparaciones/recetas/[recetaId]) shows -- the receta (header, toma,
 * ítems with componentes), each ítem's latest ficha técnica with its líneas
 * de pesaje, and each ítem's INICIADA/CONFIRMADA preparación. `null` when
 * the receta does not exist (in this tenant).
 *
 * Purity per partida (migration 0058): every non-manual línea of an ítem
 * still to be reserved (no preparación, or an INICIADA one without reservas)
 * also lists the partidas the confirmation would draw from, with the
 * PHYSICAL weight each one needs (./partidas-para-pesar.ts, shared with the
 * draft preview `preparaciones.toma.previsualizarFichas`). An ítem with stock
 * reserved lists its reservas instead (migration 0071).
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
import { getRecetaDeToma, jornadaActualTenant } from "../infrastructure/preparacion-repository";
import type {
  FichaDeItemToma as FichaDeItemTomaBase,
  ItemDeToma as ItemDeTomaBase,
  LineaDeFichaToma as LineaDeFichaTomaBase,
  PreparacionDeItemToma as PreparacionDeItemTomaBase,
  RecetaDeToma as RecetaDeTomaBase,
  ReservaDeItemToma as ReservaDeItemTomaBase,
} from "../infrastructure/preparacion-repository";
import { cargarPartidasPorDroga, esLineaPesable, partidasDeLinea } from "./partidas-para-pesar";
import type { PartidaParaPesar } from "./partidas-para-pesar";

export type { PartidaParaPesar };

export interface LineaDeFichaToma extends LineaDeFichaTomaBase {
  /** `null` for manual-enrase líneas, líneas without cantidadAPesar, and ítems already CONFIRMADA or with stock reserved. */
  partidas: PartidaParaPesar[] | null;
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
}

export interface ItemDeToma extends Omit<ItemDeTomaBase, "ultimaFicha" | "preparacion"> {
  ultimaFicha: FichaDeItemToma | null;
  preparacion: PreparacionDeItemToma | null;
}

export interface RecetaDeToma extends Omit<RecetaDeTomaBase, "items"> {
  items: ItemDeToma[];
}

const getTomaRecetaInput = z.object({ recetaId: uuid });

export const getTomaRecetaQuery = defineQuery({
  name: "preparaciones.toma.ver",
  permiso: "preparaciones.iniciar",
  input: getTomaRecetaInput,
  handler: async ({ tx, session, input }): Promise<RecetaDeToma | null> => {
    const receta = await getRecetaDeToma(tx, session.tenantId, input.recetaId);
    if (!receta) return null;

    // A CONFIRMADA ítem already drew its partidas, a reserved one already chose them: nothing left to weigh from.
    const porElegir = (item: ItemDeTomaBase) => item.preparacion?.estado !== "CONFIRMADA" && (item.preparacion?.reservas.length ?? 0) === 0;
    const lineasPorPesar = (item: ItemDeTomaBase) => (porElegir(item) ? (item.ultimaFicha?.lineas ?? []) : []);
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
      items: receta.items.map((item) => ({
        ...item,
        preparacion: item.preparacion ? { ...item.preparacion, reservas: item.preparacion.reservas.map(conVencimiento) } : null,
        ultimaFicha: item.ultimaFicha
          ? {
              ...item.ultimaFicha,
              lineas: item.ultimaFicha.lineas.map((linea) => ({
                ...linea,
                partidas: porElegir(item) ? partidasDeLinea(partidasPorDroga, linea) : null,
              })),
            }
          : null,
      })),
    };
  },
});

export async function getTomaReceta(recetaId: string): Promise<RecetaDeToma | null> {
  return getTomaRecetaQuery.execute({ recetaId });
}
