/**
 * What the reserva / confirmation form (ui/confirmar-form.tsx) needs for a ficha técnica: its líneas de pesaje, each
 * with its candidate partidas (every eligible one of the droga: available, not expired) and the AUTOMATIC plan over
 * them (`repartirLinea`, domain/reparto-linea.ts -- abiertas first, then FEFO; the SAME function and candidates
 * `planificarConsumoEnTx` uses; amounts are PHYSICAL, after the partida's purity correction), so the lab sees which
 * partida to take and how much (docs/specs/reserva-stock-preparacion.md R1, DT decision 2026-10-15). Nothing is
 * chosen here: the amounts and partidas are display-only, the server recomputes them under its locks. Plus whether
 * today's jornada is already closed (`cierre_diario`), the confirmation's friendly INV-C03 pre-check, shown up front.
 *
 * An enrase manual línea has no fixed quantity yet: no plan here; the form previews it with `repartirLinea` over
 * `partidasElegibles` as the quantity is typed.
 *
 * Shared by `preparaciones.pantalla` (an existing preparación), `preparaciones.confirmacionDeFicha` (the toma
 * workspace's dialog, before any preparación exists) and `preparaciones.recalculoDeReserva`. Not a use case: callers
 * run it inside their own transaction. Plain reads only.
 *
 * Stock reserved by OTHER preparaciones INICIADA (migration 0071) is not available here; `preparacionPropiaId`'s own
 * reservas are.
 *
 * Units, as in the confirmation: the línea's cantidadAPesar (línea unit, e.g. g) is converted into the droga's unidad
 * base (e.g. mg) before the split; the plan and the partidas' balances are in the droga's unidad base
 * (`unidadStock.simbolo`), the shortfall in the línea's unit.
 */
import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/shared/decimal";
import { convertirCantidad, mismaMagnitud } from "@/shared/decimal/convertir-unidad";
import { estaVencida } from "@/modules/stock/domain/reparto";
import { requiereMotivoAperturaAdicional } from "../domain/apertura-adicional";
import { repartirLinea } from "../domain/reparto-linea";
import type { UnidadFormato } from "@/shared/format/cantidad";
import { diasAlertaVencimientoEnTx } from "@/modules/stock/application/dias-alerta-vencimiento";
import { getLineasParaPreparacion, listPartidasElegiblesDroga, listUnidadesFormato, jornadaActualTenant, existeCierreParaJornada } from "../infrastructure/preparacion-repository";
import type { LineaParaPantalla, PartidaElegible } from "../infrastructure/preparacion-repository";

export interface LineaPantalla extends LineaParaPantalla {
  /** Every eligible partida of the droga, not expired, in id order: the automatic plan's candidates (the form previews an enrase manual línea over them). */
  partidasElegibles: PartidaElegible[];
  /**
   * The automatic plan, in consumption order; `null` for manual-enrase lines (no fixed quantity yet), when stock is
   * insufficient or when the línea's unit can not be converted into the droga's unidad base. `cantidad` (PHYSICAL,
   * purity-corrected, droga's unidad base) is a decimal string: this crosses into a Client Component.
   */
  propuesta: { partidaId: string; cantidad: string }[] | null;
  stockInsuficiente: boolean;
  /** In ACTIVE terms, in the línea's unit (same unit as cantidadAPesar). */
  faltante: string | null;
  /** INV-S18 over the plan: never with the automatic order (abiertas first), kept so the form asks the motivo if the rule ever says so. */
  requiereMotivo: boolean;
  /** Only when recalculating a reserva (./get-recalculo-de-reserva.ts): its current entrada, to prefill the form. */
  reserva?: EntradaReservada | null;
}

/** A línea's current reserva entrada (migration 0071), as plain values. */
export interface EntradaReservada {
  cantidadManual: string | null;
  motivoAperturaAdicional: string | null;
}

export interface DatosConfirmacion {
  fichaTecnicaId: string;
  jornadaActual: string;
  /** Today's jornada already has a `cierre_diario`: the confirmation would be refused. */
  jornadaCerrada: boolean;
  /** `dias_alerta_vencimiento_partida`: the form flags each planned partida por vencer (`estadoVencimientoPartida`). */
  diasAlertaVencimiento: number;
  lineas: LineaPantalla[];
  /** The global unit catalog, so the form shows stock amounts in a readable unit (`shared/format/cantidad.ts`, display only). */
  unidades: UnidadFormato[];
}

export async function construirDatosConfirmacion(
  tx: Prisma.TransactionClient,
  tenantId: string,
  fichaTecnicaId: string,
  preparacionPropiaId: string | null = null,
): Promise<DatosConfirmacion> {
  const jornada = await jornadaActualTenant(tx, tenantId);
  const lineasDb = await getLineasParaPreparacion(tx, tenantId, fichaTecnicaId);

  const lineas: LineaPantalla[] = [];
  for (const linea of lineasDb) {
    const partidasElegibles = (await listPartidasElegiblesDroga(tx, tenantId, linea.drogaId, preparacionPropiaId)).filter(
      (p) => !estaVencida(p.fechaVencimiento, jornada),
    );
    const sinPlan = { ...linea, partidasElegibles, propuesta: null, stockInsuficiente: false, faltante: null, requiereMotivo: false };

    // A línea whose unit can not be converted into the droga's unidad base gets no plan: the server refuses it with its own message.
    if (linea.esEnraseManual || !linea.cantidadAPesar || !mismaMagnitud(linea.unidad, linea.unidadStock)) {
      lineas.push(sinPlan);
      continue;
    }

    const requeridaStock = convertirCantidad(dec(linea.cantidadAPesar), linea.unidad, linea.unidadStock);
    const resultado = repartirLinea(partidasElegibles, requeridaStock, jornada, false);

    if (resultado.ok) {
      const usadas = new Set(resultado.partes.map((p) => p.partidaId));
      lineas.push({
        ...sinPlan,
        propuesta: resultado.partes.map((p) => ({ partidaId: p.partidaId, cantidad: p.cantidad.toString() })),
        requiereMotivo: requiereMotivoAperturaAdicional(
          partidasElegibles.map((p) => ({ ...p, elegida: usadas.has(p.id) })),
          requeridaStock,
          jornada,
        ),
      });
    } else {
      const faltante = convertirCantidad(resultado.faltante, linea.unidadStock, linea.unidad);
      lineas.push({ ...sinPlan, stockInsuficiente: true, faltante: faltante.toFixed() });
    }
  }

  return {
    fichaTecnicaId,
    jornadaActual: jornada,
    jornadaCerrada: await existeCierreParaJornada(tx, tenantId, jornada),
    diasAlertaVencimiento: await diasAlertaVencimientoEnTx(tx, tenantId),
    lineas,
    unidades: await listUnidadesFormato(tx),
  };
}
