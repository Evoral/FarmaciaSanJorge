/**
 * What the confirmación form (ui/confirmar-form.tsx) needs for a ficha
 * técnica: its líneas de pesaje, each with its eligible partidas and the
 * system's OWN proposal via `proponerRepartoActivo` (domain/potencia.ts:
 * `proponerReparto`'s order, in ACTIVE terms -- the SAME function
 * `confirmarPreparacion` uses; amounts are PHYSICAL, after the partida's
 * purity correction) so the farmacéutico sees exactly what the confirmation
 * would draw from by default; the amounts shown are NEVER editable
 * (INV-S13/S20) -- only WHICH partidas to draw from can be changed
 * (INV-S15), which the confirmation recomputes server-side regardless.
 * Plus whether today's jornada is already closed (`cierre_diario`), the
 * confirmation's friendly INV-C03 pre-check, shown up front.
 *
 * Shared by `preparaciones.pantalla` (an existing preparación) and
 * `preparaciones.confirmacionDeFicha` (the toma workspace's dialog, before
 * any preparación exists). Not a use case: callers run it inside their own
 * transaction. Plain reads only.
 *
 * Stock reserved by OTHER preparaciones INICIADA (migration 0071) is not
 * available here; `preparacionPropiaId`'s own reservas are.
 */
import type { Prisma } from "@/generated/prisma/client";
import { dec } from "@/shared/decimal";
import { proponerRepartoActivo } from "../domain/potencia";
import { getLineasParaPreparacion, listPartidasElegiblesDroga, jornadaActualTenant, existeCierreParaJornada } from "../infrastructure/preparacion-repository";
import type { LineaParaPantalla, PartidaElegible } from "../infrastructure/preparacion-repository";

export interface LineaPantalla extends LineaParaPantalla {
  partidasElegibles: PartidaElegible[];
  /** The system's own default split, `null` for manual-enrase lines (no fixed quantity to split yet) or when stock is insufficient. `cantidad` (PHYSICAL, purity-corrected) is a decimal string: this crosses into a Client Component, which only accepts plain values. */
  propuesta: { partidaId: string; cantidad: string }[] | null;
  stockInsuficiente: boolean;
  /** In ACTIVE terms (same unit as cantidadAPesar). */
  faltante: string | null;
  /** Only when modifying a reserva (./get-modificacion-de-reserva.ts): what the línea reserves now, to prefill the form. */
  reserva?: LineaReservada | null;
}

/** A línea's current reserva (migration 0071), as plain values. */
export interface LineaReservada {
  partidaIds: string[];
  cantidadManual: string | null;
  motivoAperturaAdicional: string | null;
}

export interface DatosConfirmacion {
  fichaTecnicaId: string;
  jornadaActual: string;
  /** Today's jornada already has a `cierre_diario`: the confirmation would be refused. */
  jornadaCerrada: boolean;
  lineas: LineaPantalla[];
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
    const partidasElegibles = await listPartidasElegiblesDroga(tx, tenantId, linea.drogaId, preparacionPropiaId);

    if (linea.esEnraseManual || !linea.cantidadAPesar) {
      lineas.push({ ...linea, partidasElegibles, propuesta: null, stockInsuficiente: false, faltante: null });
      continue;
    }

    const resultado = proponerRepartoActivo(partidasElegibles, dec(linea.cantidadAPesar), jornada);

    if (resultado.ok) {
      lineas.push({ ...linea, partidasElegibles, propuesta: resultado.lineas.map((p) => ({ partidaId: p.partidaId, cantidad: p.cantidad.toString() })), stockInsuficiente: false, faltante: null });
    } else {
      lineas.push({ ...linea, partidasElegibles, propuesta: null, stockInsuficiente: true, faltante: resultado.faltante.toString() });
    }
  }

  return {
    fichaTecnicaId,
    jornadaActual: jornada,
    jornadaCerrada: await existeCierreParaJornada(tx, tenantId, jornada),
    lineas,
  };
}
