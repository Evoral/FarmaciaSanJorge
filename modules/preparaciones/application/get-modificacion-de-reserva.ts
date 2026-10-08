/**
 * `getModificacionDeReserva`: what the toma workspace's "Modificar reserva"
 * dialog (ui/continuar-preparacion-dialog.tsx) shows for a preparación whose
 * stock is reserved (docs/specs/reserva-stock-preparacion.md): the same data
 * as the "Continuar" dialog (./datos-confirmacion.ts) with the preparación's
 * OWN reservas available to it, plus each línea's current reserva to prefill
 * the form (chosen partidas, enrase manual quantity, motivo). Read-only,
 * `preparaciones.iniciar` (same as every confirmation read); the change is
 * written by `modificarReservaStock` (./modificar-reserva-stock.ts).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { getPreparacionParaAccion, listReservasDePreparacion } from "../infrastructure/preparacion-repository";
import { construirDatosConfirmacion, type DatosConfirmacion, type LineaReservada } from "./datos-confirmacion";

const getModificacionDeReservaInput = z.object({ preparacionId: uuid });

export const getModificacionDeReservaQuery = defineQuery({
  name: "preparaciones.modificacionDeReserva",
  permiso: "preparaciones.iniciar",
  input: getModificacionDeReservaInput,
  handler: async ({ tx, session, input }): Promise<DatosConfirmacion> => {
    const preparacion = await getPreparacionParaAccion(tx, session.tenantId, input.preparacionId);
    if (!preparacion) throw new NotFoundError("Preparación no encontrada.");
    const reservas = preparacion.estado === "INICIADA" ? await listReservasDePreparacion(tx, session.tenantId, preparacion.id) : [];
    if (reservas.length === 0) throw new DomainError("Esta preparación no tiene stock reservado.");

    const porLinea = new Map<string, LineaReservada>();
    for (const r of reservas) {
      const linea = porLinea.get(r.lineaPesajeId);
      if (linea) linea.partidaIds.push(r.partidaId);
      else porLinea.set(r.lineaPesajeId, { partidaIds: [r.partidaId], cantidadManual: r.cantidadManual, motivoAperturaAdicional: r.motivoAperturaAdicional });
    }

    const datos = await construirDatosConfirmacion(tx, session.tenantId, preparacion.fichaTecnicaId, preparacion.id);
    return { ...datos, lineas: datos.lineas.map((linea) => ({ ...linea, reserva: porLinea.get(linea.id) ?? null })) };
  },
});

export async function getModificacionDeReserva(preparacionId: string): Promise<DatosConfirmacion> {
  return getModificacionDeReservaQuery.execute({ preparacionId });
}
