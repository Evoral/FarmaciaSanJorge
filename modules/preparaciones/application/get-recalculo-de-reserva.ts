/**
 * `getRecalculoDeReserva`: what the toma workspace's "Recalcular reserva" dialog (ui/continuar-preparacion-dialog.tsx)
 * shows for a preparación whose stock is reserved (docs/specs/reserva-stock-preparacion.md R1b): the same automatic
 * plan as the "Marcar como preparada" dialog (./datos-confirmacion.ts) with the preparación's OWN reservas available
 * to it, plus each línea's current entrada (enrase manual quantity, motivo, the partidas it draws from -- R25) to
 * prefill the form. Read-only, `preparaciones.iniciar` (same as every confirmation read); the change is written by
 * `recalcularReservaStock` (./recalcular-reserva-stock.ts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { dec } from "@/shared/decimal";
import { getPreparacionParaAccion, listReservasDePreparacion } from "../infrastructure/preparacion-repository";
import { construirDatosConfirmacion, type DatosConfirmacion, type EntradaReservada } from "./datos-confirmacion";

const getRecalculoDeReservaInput = z.object({ preparacionId: uuid });

export const getRecalculoDeReservaQuery = defineQuery({
  name: "preparaciones.recalculoDeReserva",
  permiso: "preparaciones.iniciar",
  input: getRecalculoDeReservaInput,
  handler: async ({ tx, session, input }): Promise<DatosConfirmacion> => {
    const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    if (!preparacion) throw new NotFoundError("Preparación no encontrada.");
    const reservas = preparacion.estado === "INICIADA" ? await listReservasDePreparacion(tx, session.tenantId, preparacion.id) : [];
    if (reservas.length === 0) throw new DomainError("Esta preparación no tiene stock reservado.");

    const porLinea = new Map<string, EntradaReservada>();
    for (const r of reservas) {
      const entrada = porLinea.get(r.lineaPesajeId) ?? { cantidadManual: r.cantidadManual, motivoAperturaAdicional: r.motivoAperturaAdicional, partidaIds: [], cantidadReal: r.cantidadReal };
      if (dec(r.cantidad).greaterThan(0)) entrada.partidaIds.push(r.partidaId);
      porLinea.set(r.lineaPesajeId, entrada);
    }

    const datos = await construirDatosConfirmacion(tx, session.tenantId, preparacion.fichaTecnicaId, preparacion.id);
    return { ...datos, lineas: datos.lineas.map((linea) => ({ ...linea, reserva: porLinea.get(linea.id) ?? null })) };
  },
});

export async function getRecalculoDeReserva(preparacionId: string): Promise<DatosConfirmacion> {
  return getRecalculoDeReservaQuery.execute({ preparacionId });
}
