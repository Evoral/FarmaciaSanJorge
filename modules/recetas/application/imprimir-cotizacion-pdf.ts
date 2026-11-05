/**
 * `imprimirCotizacionPdf` (openspec/specs/presupuesto-receta, "Ticket de cotización"): the ticket handed to a client
 * who only asks for the price, printed from the "Precio" box while a receta is being loaded. Nothing is saved: the
 * price is recomputed here from the same draft (`presupuestar`, the live presupuesto's code path), never taken from
 * the browser. Paciente and médico travel as the names the form shows (they may not be saved yet in an importación);
 * they are only printed. The ONLY entry point `app/api/recetas/cotizacion/pdf/route.ts` uses.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { formatFecha } from "@/shared/format/fecha";
import { FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";
import { getMarcaTenant } from "@/modules/farmacia/application/get-marca-tenant";
import { armarTicketCotizacion, type TicketCotizacion } from "../domain/ticket-cotizacion";
import { buildTicketCotizacionPdf } from "../infrastructure/ticket-cotizacion-pdf";
import { zonaHorariaTenant } from "../infrastructure/receta-repository";
import { itemInput } from "./crear-receta";
import { presupuestar } from "./presupuestar-receta";

const nombreImpreso = z
  .string()
  .trim()
  .max(200)
  .transform((valor) => valor || null)
  .nullable()
  .default(null);

const imprimirCotizacionInput = z.object({
  items: z.array(itemInput).min(1, "La receta debe tener al menos un ítem."),
  paciente: nombreImpreso,
  medico: nombreImpreso,
  farmacia: z.string(),
});

export type ImprimirCotizacionWireInput = Omit<z.input<typeof imprimirCotizacionInput>, "farmacia">;

export const getTicketCotizacionQuery = defineQuery({
  name: "recetas.cotizacion.ticket",
  permiso: "cotizaciones.calcular",
  input: imprimirCotizacionInput,
  handler: async ({ tx, session, input }): Promise<TicketCotizacion> => {
    const presupuesto = await presupuestar(tx, session.tenantId, input.items);
    const zonaHoraria = await zonaHorariaTenant(tx, session.tenantId);
    return armarTicketCotizacion({
      farmacia: input.farmacia,
      fecha: formatFecha(new Date(), zonaHoraria),
      paciente: input.paciente,
      medico: input.medico,
      items: input.items.map((item) => item.descripcion?.trim() || FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]),
      presupuesto,
    });
  },
});

export async function imprimirCotizacionPdf(input: ImprimirCotizacionWireInput): Promise<Buffer> {
  const marca = await getMarcaTenant();
  const ticket = await getTicketCotizacionQuery.execute({ ...input, farmacia: marca?.nombre ?? "" });
  return buildTicketCotizacionPdf(ticket);
}
