/**
 * Content of the cotización ticket handed to a client who only asks for the price (openspec/specs/presupuesto-receta,
 * "Ticket de cotización"). Pure: the price comes from the same presupuesto the panel shows, already computed.
 *
 * Each ítem reads as its "Nombre del preparado" or, without one, its forma ("Crema"). One ítem carries the price on
 * its own line; with more there is no per-ítem price to show yet, so they are listed and only the total is printed.
 * Paciente and médico appear only when loaded.
 */
import { DomainError } from "@/shared/errors";
import type { Presupuesto } from "./presupuesto";

export interface TicketCotizacion {
  farmacia: string;
  fecha: string;
  paciente: string | null;
  medico: string | null;
  renglones: { texto: string; precio: string | null }[];
  /** Only with more than one ítem: one ítem's price is on its renglón. */
  total: string | null;
}

export interface DatosTicketCotizacion {
  farmacia: string;
  fecha: string;
  paciente: string | null;
  medico: string | null;
  /** Each ítem's text, in order: its name or its forma. */
  items: string[];
  presupuesto: Presupuesto;
}

export const MENSAJE_COTIZACION_INCOMPLETA = "No se puede imprimir la cotización: hay ítems sin precio. Revisá el recuadro Precio.";

export function armarTicketCotizacion(datos: DatosTicketCotizacion): TicketCotizacion {
  const { presupuesto } = datos;
  if (!presupuesto.ok) throw new DomainError(presupuesto.mensaje);
  // A total that leaves an ítem out would be a wrong price in the client's hand.
  if (!presupuesto.totalCompleto) throw new DomainError(MENSAJE_COTIZACION_INCOMPLETA);
  const unico = datos.items.length === 1;
  return {
    farmacia: datos.farmacia,
    fecha: datos.fecha,
    paciente: datos.paciente,
    medico: datos.medico,
    renglones: datos.items.map((texto) => ({ texto, precio: unico ? presupuesto.total : null })),
    total: unico ? null : presupuesto.total,
  };
}
